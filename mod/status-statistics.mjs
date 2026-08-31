const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;

export function format_account_age(account_age, language, get_lang_string) {
	if (!Number.isSafeInteger(account_age) || account_age < 0)
		return '';

	let remaining = account_age;
	const units = [];
	const add_unit = (value, singular_lang_id, plural_lang_id, placeholder) => {
		if (value > 0) {
			const lang_id = value === 1 ? singular_lang_id : plural_lang_id;
			units.push(get_lang_string(lang_id).replace('${' + placeholder + '}', String(value)).replace(/(\d) /g, '$1\u00a0'));
		}
	};

	const years = Math.floor(remaining / YEAR);
	remaining %= YEAR;
	const days = Math.floor(remaining / DAY);
	remaining %= DAY;
	const hours = Math.floor(remaining / HOUR);
	remaining %= HOUR;
	const minutes = Math.floor(remaining / MINUTE);
	add_unit(years, 'TIME_UNIT_year', 'TIME_UNIT_years', 'years');
	add_unit(days, 'TIME_UNIT_day', 'TIME_UNIT_days', 'days');
	add_unit(hours, 'TIME_UNIT_hour', 'TIME_UNIT_hours', 'hours');
	add_unit(minutes, 'TIME_UNIT_minute', 'TIME_UNIT_minutes', 'minutes');
	if (units.length === 0)
		units.push(get_lang_string('TIME_UNIT_minutes').replace('${minutes}', '0').replace(/(\d) /g, '$1\u00a0'));

	return new Intl.ListFormat(language || 'en', { style: 'long', type: 'unit' }).format(units);
}
