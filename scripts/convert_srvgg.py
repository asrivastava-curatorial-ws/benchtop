"""Convert Real-ESRGAN's realesr-general-x4v3.pth (SRVGGNetCompact) to ONNX without PyTorch.

Usage: python3 -I scripts/convert_srvgg.py realesr-general-x4v3.pth realesr-general-x4v3.onnx

The .pth file is a zip of pickled tensors; it is read with a restricted unpickler that
only rebuilds float tensors.  The ONNX graph is written with a small protobuf encoder:
Conv + PReLU x 34, DepthToSpace (PixelShuffle), nearest Resize of the input, Add.
"""
import pickle
import struct
import sys
import zipfile
from collections import OrderedDict

import numpy as np

# --------------------------------------------------------------------------- reading the .pth


def load_pth(path):
    archive = zipfile.ZipFile(path)
    names = archive.namelist()
    prefix = names[0].split("/")[0]
    storages = {}

    class Storage:
        def __init__(self, dtype):
            self.dtype = dtype

    def rebuild_tensor(storage, offset, size, stride, *_):
        data = storage
        itemsize = data.itemsize
        return np.lib.stride_tricks.as_strided(data[offset:], shape=tuple(size), strides=tuple(s * itemsize for s in stride)).copy()

    class Unpickler(pickle.Unpickler):
        def find_class(self, module, name):
            if module == "collections" and name == "OrderedDict":
                return OrderedDict
            if module == "torch._utils" and name == "_rebuild_tensor_v2":
                return rebuild_tensor
            if module == "torch" and name == "FloatStorage":
                return Storage(np.float32)
            if module == "torch" and name == "HalfStorage":
                return Storage(np.float16)
            raise pickle.UnpicklingError(f"refusing to load {module}.{name}")

        def persistent_load(self, pid):
            _, storage_type, key, _location, _numel = pid
            if key not in storages:
                raw = archive.read(f"{prefix}/data/{key}")
                storages[key] = np.frombuffer(raw, dtype=storage_type.dtype)
            return storages[key]

    with archive.open(f"{prefix}/data.pkl") as handle:
        state = Unpickler(handle).load()
    for key in ("params_ema", "params"):
        if isinstance(state, dict) and key in state:
            return state[key]
    return state


# --------------------------------------------------------------------------- protobuf writer


def varint(value):
    out = bytearray()
    value &= (1 << 64) - 1
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def field_varint(number, value):
    return varint(number << 3) + varint(value)


def field_bytes(number, data):
    if isinstance(data, str):
        data = data.encode()
    return varint((number << 3) | 2) + varint(len(data)) + data


def field_float(number, value):
    return varint((number << 3) | 5) + struct.pack("<f", value)


def tensor(name, array):
    array = np.ascontiguousarray(array, dtype=np.float32)
    out = b"".join(field_varint(1, d) for d in array.shape)
    return out + field_varint(2, 1) + field_bytes(8, name) + field_bytes(9, array.tobytes())


def attr_int(name, value):
    return field_bytes(1, name) + field_varint(3, value) + field_varint(20, 2)


def attr_ints(name, values):
    return field_bytes(1, name) + b"".join(field_varint(8, v) for v in values) + field_varint(20, 7)


def attr_str(name, value):
    return field_bytes(1, name) + field_bytes(4, value) + field_varint(20, 3)


def node(op, inputs, outputs, name, attrs=()):
    out = b"".join(field_bytes(1, i) for i in inputs) + b"".join(field_bytes(2, o) for o in outputs)
    return out + field_bytes(3, name) + field_bytes(4, op) + b"".join(field_bytes(5, a) for a in attrs)


def value_info(name, dims):
    shape = b"".join(field_bytes(1, field_varint(1, d) if isinstance(d, int) else field_bytes(2, d)) for d in dims)
    tensor_type = field_varint(1, 1) + field_bytes(2, shape)
    return field_bytes(1, name) + field_bytes(2, field_bytes(1, tensor_type))


# --------------------------------------------------------------------------- graph


def convert(params, scale=4):
    convs = sorted({int(k.split(".")[1]) for k in params if k.endswith(".weight") and params[k].ndim == 4})
    prelus = {int(k.split(".")[1]) for k in params if k.endswith(".weight") and params[k].ndim == 1}
    nodes, inits = [], []
    current = "input"
    for index in sorted(convs + list(prelus)):
        key = f"body.{index}"
        if index in prelus:
            slope = params[f"{key}.weight"].astype(np.float32).reshape(-1, 1, 1)
            inits.append(tensor(f"{key}.slope", slope))
            nodes.append(node("PRelu", [current, f"{key}.slope"], [f"{key}.out"], f"prelu{index}"))
        else:
            weight = params[f"{key}.weight"].astype(np.float32)
            bias = params[f"{key}.bias"].astype(np.float32)
            inits += [tensor(f"{key}.weight", weight), tensor(f"{key}.bias", bias)]
            attrs = [attr_ints("kernel_shape", list(weight.shape[2:])), attr_ints("pads", [1, 1, 1, 1]), attr_ints("strides", [1, 1])]
            nodes.append(node("Conv", [current, f"{key}.weight", f"{key}.bias"], [f"{key}.out"], f"conv{index}", attrs))
        current = f"{key}.out"
    nodes.append(node("DepthToSpace", [current], ["shuffled"], "pixel_shuffle", [attr_int("blocksize", scale), attr_str("mode", "CRD")]))
    inits.append(tensor("resize_scales", np.array([1, 1, scale, scale], dtype=np.float32)))
    nodes.append(
        node(
            "Resize",
            ["input", "", "resize_scales"],
            ["base"],
            "nearest_base",
            [attr_str("mode", "nearest"), attr_str("coordinate_transformation_mode", "asymmetric"), attr_str("nearest_mode", "floor")],
        )
    )
    nodes.append(node("Add", ["shuffled", "base"], ["output"], "residual"))
    graph = b"".join(field_bytes(1, n) for n in nodes) + field_bytes(2, "realesr_general_x4v3")
    graph += b"".join(field_bytes(5, t) for t in inits)
    graph += field_bytes(11, value_info("input", [1, 3, "height", "width"]))
    graph += field_bytes(12, value_info("output", [1, 3, "out_height", "out_width"]))
    opset = field_bytes(1, "") + field_varint(2, 17)
    doc = "Real-ESRGAN realesr-general-x4v3 (SRVGGNetCompact), BSD-3-Clause, Xintao Wang et al. Converted for Benchtop."
    return field_varint(1, 8) + field_bytes(2, "benchtop-convert-srvgg") + field_bytes(6, doc) + field_bytes(7, graph) + field_bytes(8, opset)


if __name__ == "__main__":
    params = load_pth(sys.argv[1])
    with open(sys.argv[2], "wb") as out:
        out.write(convert(params))
    print("wrote", sys.argv[2], len(params), "tensors")
