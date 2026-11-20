/**
 * Exact definitions the unit catalogue builds on (NIST SP 811, the 1959
 * international yard and pound agreement, BIPM SI Brochure, CODATA 2022).
 */
export const IN = 0.0254;
export const FT = 0.3048;
export const YD = 0.9144;
export const MI = 1609.344;
export const NMI = 1852;
export const IN2 = IN * IN;
export const IN3 = IN2 * IN;
export const FT2 = FT * FT;
export const FT3 = FT2 * FT;
export const YD2 = YD * YD;
export const ACRE = 4046.8564224;

export const LB = 0.45359237;
export const OZ = LB / 16;
export const GRAIN = 6.479891e-5;
export const TROY_OZ = 0.0311034768;
export const TOLA = 0.0116638038;

export const GAL = 3.785411784e-3;
export const IMPGAL = 4.54609e-3;

export const G0 = 9.80665;
export const LBF = LB * G0;

/** International Table calorie and BTU. */
export const CAL_IT = 4.1868;
export const BTU = CAL_IT * LB * 1000 * (5 / 9);
/** Thermochemical calorie and BTU. */
export const CAL = 4.184;
export const BTU_TH = CAL * LB * 1000 * (5 / 9);

export const HOUR = 3600;
export const DAY = 86400;
/** The Gregorian average year, 365.2425 days. */
export const YEAR = 31556952;

export const C = 299792458;
export const H = 6.62607015e-34;
export const E_CHARGE = 1.602176634e-19;
export const NA = 6.02214076e23;
export const R_GAS = 8.314462618;

export const HP = 550 * LBF * FT;
export const HP_METRIC = 75 * G0;
export const TON_REFRIGERATION = (12000 * BTU) / HOUR;
