import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

const TYPES: Record<string, string> = {
  MOBILE: 'Mobile',
  FIXED_LINE: 'Landline',
  FIXED_LINE_OR_MOBILE: 'Landline or mobile',
  TOLL_FREE: 'Toll-free',
  PREMIUM_RATE: 'Premium rate',
  SHARED_COST: 'Shared cost',
  VOIP: 'VoIP',
  PERSONAL_NUMBER: 'Personal number',
  PAGER: 'Pager',
  UAN: 'Universal access number',
  VOICEMAIL: 'Voicemail',
};

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'number', label: 'Phone number', type: 'text', default: '+1 202-555-0143', mono: true, wide: true },
    { key: 'country', label: 'Country for numbers without +code', type: 'text', default: 'IN', placeholder: 'Two-letter code, e.g. IN, US, GB' },
  ],
  runOnEmpty: true,
  async run(_input, o) {
    const { parsePhoneNumberWithError, getCountryCallingCode } = await import('libphonenumber-js/max');
    if (o.number.trim() === '') return {};
    let phone: Awaited<ReturnType<typeof parsePhoneNumberWithError>>;
    try {
      phone = parsePhoneNumberWithError(o.number, { defaultCountry: (o.country.trim().toUpperCase() || undefined) as never });
    } catch (error) {
      const reasons: Record<string, string> = {
        INVALID_COUNTRY: 'The country could not be worked out: add +code or choose a country.',
        NOT_A_NUMBER: 'That is not a phone number.',
        TOO_SHORT: 'The number is too short.',
        TOO_LONG: 'The number is too long.',
      };
      throw new ToolError(reasons[error instanceof Error ? error.message : ''] ?? 'That is not a phone number.');
    }
    const valid = phone.isValid();
    const type = phone.getType();
    const fields: Field[] = [
      { label: 'Valid', value: valid ? 'Yes' : phone.isPossible() ? 'Possible length, but not a number in use' : 'No', tone: valid ? 'ok' : 'bad' },
      { label: 'Country', value: phone.country ? `${phone.country} (+${getCountryCallingCode(phone.country)})` : `+${phone.countryCallingCode}` },
      { label: 'Type', value: type ? (TYPES[type] ?? type) : 'Unknown' },
      { label: 'International', value: phone.formatInternational(), mono: true },
      { label: 'National', value: phone.formatNational(), mono: true },
      { label: 'E.164', value: phone.format('E.164'), mono: true },
      { label: 'Link', value: phone.getURI(), mono: true },
    ];
    if (phone.ext) fields.push({ label: 'Extension', value: phone.ext, mono: true });
    return { fields };
  },
});
