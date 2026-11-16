import { describe, expect, it } from 'vitest';
import { adiabaticArea, currentFor, fillLimit, IEC_BREAKERS, iecProtectiveConductor, NEC_MOTOR_3PH_460, nextSize, powerFor, rtdResistance, rtdTemperature } from '../../src/lib/electrical';
import { frictionFactor, saturationPressure as magnus, water } from '../../src/lib/fluids';
import { enthalpy, humidityRatioFromRh, humidityRatioFromWetBulb, mix, pressureAtAltitude, saturationPressure, wetBulb } from '../../src/lib/psychro';
import { refrigerant, saturationPressures, saturationTemperature } from '../../src/lib/refrigerant';
import airChanges from '../../src/tools/text/air-changes';
import airLeak from '../../src/tools/text/air-leak';
import airPipe, { airPressureDrop } from '../../src/tools/text/air-pipe';
import battery from '../../src/tools/text/battery-calculator';
import bearing from '../../src/tools/text/bearing-life';
import cableSize from '../../src/tools/text/cable-size';
import chiller from '../../src/tools/text/chiller';
import compressor from '../../src/tools/text/compressor-sizing';
import coolingLoad from '../../src/tools/text/cooling-load';
import datacentre from '../../src/tools/text/datacentre-power';
import dewPoint from '../../src/tools/text/dew-point';
import ductSizing, { equivalentDiameter } from '../../src/tools/text/duct-sizing';
import earthing from '../../src/tools/text/earthing';
import encoder from '../../src/tools/text/encoder-calculator';
import energyCost from '../../src/tools/text/energy-cost';
import evCharger from '../../src/tools/text/ev-charger';
import fanLaws, { affinity } from '../../src/tools/text/fan-laws';
import generator from '../../src/tools/text/generator-sizing';
import hydraulic from '../../src/tools/text/hydraulic-cylinder';
import motor from '../../src/tools/text/motor-calculator';
import { solveOhm } from '../../src/tools/text/ohms-law';
import pfCorrection from '../../src/tools/text/pf-correction';
import pipeFlow from '../../src/tools/text/pipe-flow';
import plcScaling from '../../src/tools/text/plc-scaling';
import pneumatic from '../../src/tools/text/pneumatic-cylinder';
import powerConverter from '../../src/tools/text/power-converter';
import psychrometrics from '../../src/tools/text/psychrometrics';
import pump from '../../src/tools/text/pump-sizing';
import rtd from '../../src/tools/text/rtd-calculator';
import seer from '../../src/tools/text/seer-savings';
import sheetMetal, { bend, dinKFactor } from '../../src/tools/text/sheet-metal';
import solar from '../../src/tools/text/solar-sizing';
import speedsFeeds, { meanChipThickness } from '../../src/tools/text/speeds-feeds';
import superheat from '../../src/tools/text/superheat';
import tapDrill, { threadPercent } from '../../src/tools/text/tap-drill';
import toolLife, { taylorC, taylorLife } from '../../src/tools/text/tool-life';
import transformer from '../../src/tools/text/transformer';
import ups from '../../src/tools/text/ups-sizing';
import valveCv from '../../src/tools/text/valve-cv';
import { field, out, run } from './helpers';

describe('electrical library', () => {
  it('converts power and current', () => {
    expect(currentFor(10_000, 415, '3', 0.85)).toBeCloseTo(16.37, 2);
    expect(currentFor(2300, 230, '1')).toBeCloseTo(10, 6);
    expect(powerFor(16.37, 415, '3', 0.85)).toBeCloseTo(10_000, -1);
  });

  it('matches IEC 60751 Pt100 values and inverts them', () => {
    expect(rtdResistance(100, 100)).toBeCloseTo(138.5055, 3);
    expect(rtdResistance(-100, 100)).toBeCloseTo(60.2558, 3);
    expect(rtdTemperature(rtdResistance(250, 1000), 1000)).toBeCloseTo(250, 4);
    expect(rtdTemperature(rtdResistance(-150, 100), 100)).toBeCloseTo(-150, 3);
  });

  it('sizes protective conductors and picks standard breakers', () => {
    expect(adiabaticArea(5000, 0.4, 143)).toBeCloseTo(22.11, 2);
    expect([10, 25, 95].map(iecProtectiveConductor)).toEqual([10, 16, 47.5]);
    expect(nextSize(IEC_BREAKERS, 40)).toBe(40);
    expect(nextSize(IEC_BREAKERS, 40.2)).toBe(50);
    expect([1, 2, 3, 9].map(fillLimit)).toEqual([0.53, 0.31, 0.4, 0.4]);
    expect(NEC_MOTOR_3PH_460[10]).toBe(14);
  });

  it("solves Ohm's law from any two values", () => {
    const result = solveOhm({ v: 230, p: 1000 });
    expect(result.i).toBeCloseTo(4.3478, 4);
    expect(result.r).toBeCloseTo(52.9, 6);
  });
});

describe('electrical calculators', () => {
  it('converts kW to kVA and amps', async () => {
    const result = await run(powerConverter, '');
    expect(field(result, 'Line current')).toMatch(/^16\.37 A/);
    expect(field(result, 'Apparent power')).toMatch(/^11\.765 kVA/);
  });

  it('sizes power factor correction', async () => {
    expect(field(await run(pfCorrection, ''), 'Capacitor bank needed')).toMatch(/^63\.13 kVAR/);
  });

  it('sizes cables, motors, transformers and earth conductors', async () => {
    expect(field(await run(cableSize, ''), 'Size for current and voltage drop')).toMatch(/^10 mm² copper/);
    const motorResult = await run(motor, '');
    expect(field(motorResult, 'Full-load current')).toMatch(/^19\.3 A/);
    expect(field(motorResult, '15 hp at 415 V')).toMatch(/^23\.3 A/);
    expect(field(await run(transformer, ''), 'Secondary')).toMatch(/^666\.7 A/);
    expect(field(await run(earthing, ''), 'Minimum area')).toMatch(/^16\.5 mm²/);
  });

  it('adds up loads for energy, generators and data centres', async () => {
    expect(field(await run(energyCost, energyCost.input ? (energyCost.input.sample ?? '') : ''), 'Load factor')).toMatch(/^45\.1%/);
    expect(field(await run(generator, generator.input ? (generator.input.sample ?? '') : ''), 'Standard set')).toMatch(/^100 kVA/);
    expect(field(await run(datacentre, ''), 'Modules installed')).toMatch(/^4 × 40 kVA \(N\+1\)/);
  });

  it('protects EV chargers at 125% of the rated current', async () => {
    expect(field(await run(evCharger, ''), 'Circuit breaker')).toMatch(/^40 A/);
    expect(field(await run(evCharger, '', { charger: '3.3' }), 'Circuit breaker')).toMatch(/^20 A/);
    expect(field(await run(evCharger, '', { charger: '30' }), 'Circuit breaker')).toMatch(/^63 A/);
  });

  it('converts RTD, PLC and encoder signals', async () => {
    expect(field(await run(rtd, ''), 'Resistance')).toMatch(/^109\.735 Ω/);
    expect(await out(plcScaling, '')).toContain('value := raw * 0.625 - 2.5;');
    expect(field(await run(encoder, ''), 'Counts per revolution')).toMatch(/^4,096/);
  });

  it('sizes UPS, batteries and solar arrays', async () => {
    expect(field(await run(ups, ''), 'Standard size')).toMatch(/^10 kVA/);
    expect(field(await run(battery, ''), 'Runtime')).toMatch(/^3 h 17 min/);
    expect(field(await run(solar, ''), 'Most panels in series')).toMatch(/^19 /);
  });
});

describe('fluids and mechanical calculators', () => {
  it('interpolates water and finds friction factors', () => {
    expect(water(20).density).toBeCloseTo(998.2, 1);
    expect(water(25).viscosity).toBeCloseTo(0.9e-3, 5);
    expect(frictionFactor(1000, 0, 0.1)).toBeCloseTo(0.064, 6);
    expect(frictionFactor(1e5, 0.045e-3, 0.1)).toBeCloseTo(0.0202, 3);
    expect(magnus(20) / 2339).toBeCloseTo(1, 2);
  });

  it('sizes pumps, pipes, valves, cylinders and bearings', async () => {
    expect(field(await run(pump, ''), 'Total dynamic head')).toMatch(/^40\.7 m/);
    expect(field(await run(pipeFlow, ''), 'Reynolds number')).toMatch(/^63,421/);
    expect(field(await run(valveCv, ''), 'Kv')).toMatch(/^16\.97/);
    expect(field(await run(hydraulic, ''), 'Push (extend)')).toMatch(/^80\.4 kN/);
    expect(field(await run(bearing, ''), 'Basic life L10')).toMatch(/^1,071\.6 million/);
  });

  it('handles compressed air', async () => {
    const cylinder = await run(pneumatic, '');
    expect(field(cylinder, 'Standard bore')).toBe('Ø50 mm with Ø20 mm rod');
    expect(field(cylinder, 'Extend')).toMatch(/^1,178 N/);
    expect(field(cylinder, 'Free air per cycle')).toMatch(/^5\.001 l/);
    expect(field(await run(compressor, compressor.input ? (compressor.input.sample ?? '') : ''), 'Receiver volume')).toMatch(/^at least 109 litres/);
    expect(field(await run(airLeak, ''), 'Air lost')).toMatch(/^433\.1 l\/min/);
    expect(airPressureDrop(2000 / 60, 80, 32, 8.01325)).toBeCloseTo(0.088, 3);
    expect(field(await run(airPipe, ''), 'Pipe size')).toBe('32 mm bore');
    const dew = await run(dewPoint, '');
    expect(field(dew, 'Atmospheric dew point')).toMatch(/^-23\.1 °C/);
    expect(field(dew, 'Class')).toMatch(/^4 /);
  });

  it('works out speeds, feeds and machining time', async () => {
    expect(meanChipThickness(0.1, 10, 10)).toBeCloseTo((2 * 0.1) / Math.PI, 6);
    const mill = await run(speedsFeeds, '');
    expect(field(mill, 'Spindle speed')).toBe('5,730 rpm');
    expect(field(mill, 'Feed rate')).toMatch(/^1,490 mm\/min/);
    expect(field(mill, 'Time for the cut')).toBe('4 s');
    const turn = await run(speedsFeeds, '', { operation: 'turn', diameter: 50, vc: 200, feed: 0.2, ap: 2, length: 300 });
    expect(field(turn, 'Metal removal rate')).toMatch(/^80 cm³/);
    expect(field(turn, 'Time for the cut')).toBe('1 min 11 s');
  });

  it('picks tap drills for metric and inch threads', async () => {
    expect(threadPercent(10, 1.5, 8.5)).toBeCloseTo(76.98, 2);
    expect(field(await run(tapDrill, ''), 'ISO 2306 recommended')).toMatch(/^8\.5 mm, 77% thread/);
    const cases: [string, string][] = [
      ['1/4-20', '#7'],
      ['1/2-13', '27/64"'],
      ['3/8-16', '5/16"'],
      ['#10-24', '#25'],
      ['5/16-18', 'F'],
    ];
    for (const [thread, drill] of cases) expect(field(await run(tapDrill, '', { thread }), 'Nearest inch drill').startsWith(`${drill} `)).toBe(true);
    expect(field(await run(tapDrill, '', { thread: 'M10x1.5', tap: 'form', percent: 65 }), 'Nearest metric drill')).toMatch(/^9\.3 mm/);
    expect(field(await run(tapDrill, '', { thread: 'G1/2' }), 'Tap drill')).toMatch(/^19 mm/);
  });

  it("applies Taylor's tool-life equation", async () => {
    const c = taylorC(200, 15, 0.25);
    expect(taylorLife(c, 200, 0.25)).toBeCloseTo(15, 6);
    const twoTests = await run(toolLife, '', { mode: 'two', v1: 200, t1: 15, v2: 250, t2: 7 });
    expect(field(twoTests, 'Taylor exponent n')).toBe('0.293');
    expect(field(await run(toolLife, ''), 'Minimum cost')).toMatch(/28 min 00 s life$/);
  });

  it('develops sheet-metal bends', async () => {
    const result = bend(2, 2, 90, 0.325);
    expect(result.allowance).toBeCloseTo(4.1626, 4);
    expect(result.setback).toBeCloseTo(4, 6);
    expect(result.deduction).toBeCloseTo(3.8374, 4);
    expect(dinKFactor(2, 2)).toBeCloseTo(0.325, 6);
    expect(dinKFactor(20, 2)).toBe(0.5);
    const tool = await run(sheetMetal, '');
    expect(field(tool, 'Flat blank length')).toBe('76.16 mm');
    expect(field(tool, 'Bending force')).toMatch(/21\.7 t$/);
  });
});

describe('psychrometrics', () => {
  it('matches ASHRAE saturation and altitude tables', () => {
    expect(saturationPressure(20)).toBeCloseTo(2339.3, 0);
    expect(saturationPressure(-10)).toBeCloseTo(259.9, 0);
    expect(saturationPressure(100)).toBeCloseTo(101418, -2);
    expect(pressureAtAltitude(1000)).toBeCloseTo(89875, -1);
  });

  it('derives humidity ratio, wet bulb and enthalpy', () => {
    const p = 101325;
    const w = humidityRatioFromRh(30, 60, p);
    expect(w).toBeCloseTo(0.016043, 5);
    expect(enthalpy(30, w)).toBeCloseTo(71.19, 2);
    const wb = wetBulb(30, w, p);
    expect(wb).toBeCloseTo(23.8, 0);
    expect(humidityRatioFromWetBulb(30, wb, p)).toBeCloseTo(w, 7);
    const mixed = mix(35, 0.02, 25, 0.01, 0.5);
    expect(mixed.w).toBeCloseTo(0.015, 9);
    expect(mixed.t).toBeCloseTo(30, 1);
  });

  it('reports a full state and validates impossible inputs', async () => {
    const result = await run(psychrometrics, '');
    expect(field(result, 'Dew point')).toMatch(/^21\.4 °C/);
    expect(field(result, 'Humidity ratio')).toMatch(/^16\.04 g\/kg/);
    await expect(run(psychrometrics, '', { known: 'wb', wetBulb: 35 })).rejects.toThrow(/cannot be above/);
    const mixed = await run(psychrometrics, '', { mixing: true });
    expect(mixed.fields?.some((item) => item.label === 'Mixed air')).toBe(true);
  });
});

describe('refrigerants', () => {
  it('matches published saturation pressures', () => {
    expect(saturationPressures(refrigerant('R134a'), 0)?.bubble).toBeCloseTo(292.8e3, -2);
    expect(saturationPressures(refrigerant('R22'), 40)?.bubble).toBeCloseTo(1533.6e3, -2);
    expect(saturationPressures(refrigerant('R32'), 0)?.bubble).toBeCloseTo(813.1e3, -2);
    expect(saturationPressures(refrigerant('R717'), 0)?.bubble).toBeCloseTo(429.4e3, -2);
    expect(saturationTemperature(refrigerant('R134a'), 292.8e3, 'dew')).toBeCloseTo(0, 1);
  });

  it('separates bubble and dew points for zeotropic blends', () => {
    const r407c = refrigerant('R407C');
    const at0 = saturationPressures(r407c, 0);
    expect(at0?.bubble).toBeGreaterThan(at0?.dew ?? Number.POSITIVE_INFINITY);
    const dew = saturationTemperature(r407c, 460.7e3, 'dew') ?? Number.NaN;
    const bubble = saturationTemperature(r407c, 460.7e3, 'bubble') ?? Number.NaN;
    expect(dew - bubble).toBeGreaterThan(4);
    expect(saturationTemperature(refrigerant('R744'), 90e5, 'bubble')).toBeUndefined();
  });

  it('works out superheat, subcooling and P–T charts', async () => {
    const result = await run(superheat, '');
    expect(field(result, 'Evaporating temperature')).toBe('5 °C');
    expect(field(result, 'Subcooling')).toMatch(/^6\.6 K/);
    const co2 = await run(superheat, '', { refrigerant: 'R744', suction: 30, suctionTemp: 0, liquid: 90 });
    expect(field(co2, 'Condensing temperature')).toMatch(/^Above the critical point/);
    const chart = await run(superheat, '', { refrigerant: 'R22', mode: 'pt', from: 0, to: 10 });
    expect(field(chart, '0 °C')).toBe('3.97 bar');
    const blend = await run(superheat, '', { refrigerant: 'R407C', mode: 'pt', from: 0, to: 10 });
    expect(field(blend, '0 °C')).toMatch(/^liquid 4\.67 bar, vapour 3\.59 bar$/);
  });
});

describe('HVAC calculators', () => {
  it('estimates cooling load and air changes', async () => {
    expect(field(await run(coolingLoad, ''), 'Air conditioner')).toMatch(/^1 TR/);
    await expect(run(coolingLoad, '', { outdoor: 20, indoor: 24 })).rejects.toThrow(/outdoor temperature/);
    const air = await run(airChanges, '');
    expect(field(air, 'Airflow')).toMatch(/^1,440 m³\/h/);
    expect(field(air, '99% removed')).toBe('46 min');
  });

  it('sizes ducts and equivalent diameters', async () => {
    expect(equivalentDiameter(600, 300)).toBeCloseTo(456.8, 0);
    expect(equivalentDiameter(400, 400)).toBeCloseTo(437.3, 0);
    const duct = await run(ductSizing, '');
    expect(field(duct, 'Round duct')).toMatch(/^Ø348 mm/);
    expect(field(duct, 'Standard size')).toMatch(/^Ø355 mm/);
  });

  it('applies the affinity laws', async () => {
    expect(affinity({ flow: 100, pressure: 100, power: 10 }, 0.5, 1, 1)).toEqual({ flow: 50, pressure: 25, power: 1.25 });
    expect(field(await run(fanLaws, ''), 'New shaft power')).toMatch(/^2\.82 kW/);
  });

  it('relates chiller flow, capacity and efficiency', async () => {
    expect(field(await run(chiller, ''), 'Cooling capacity')).toBe('349.2 kW = 99.3 TR');
    const flow = await run(chiller, '', { mode: 'flow', capacity: 100, power: 65 });
    expect(field(flow, 'kW per TR')).toBe('0.65');
    expect(field(flow, 'Chilled-water flow')).toMatch(/^60\.4/);
  });

  it('compares air-conditioner efficiency ratings', async () => {
    const result = await run(seer, '');
    expect(field(result, 'Saving with B')).toMatch(/^359 kWh/);
    const us = await run(seer, '', { rating: 'seerUs', a: 14, b: 14 });
    expect(field(us, 'Saving with B')).toMatch(/^0 kWh/);
  });
});
