/**
 * Benchtop's stand-in for CyberChef's Operation base class: the fields the
 * vendored operations set in their constructors, and nothing else.  The
 * Recipe tool reads these to show the operation and calls run() / present().
 */
export default class Operation {
    constructor() {
        this.name = "";
        this.module = "";
        this.description = "";
        this.infoURL = "";
        this.inputType = "string";
        this.outputType = "string";
        this.presentType = "";
        this.args = [];
        this.checks = [];
        this.manualBake = false;
        this.flowControl = false;
    }

    run() {
        throw new Error("This operation does nothing.");
    }

    present(data) {
        return data;
    }
}
