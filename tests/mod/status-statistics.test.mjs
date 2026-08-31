import assert from 'node:assert/strict';
import test from 'node:test';
import { format_account_age } from '../../mod/status-statistics.mjs';

const language = {
	TIME_UNIT_year: '1 year',
	TIME_UNIT_years: '${years} years',
	TIME_UNIT_day: '1 day',
	TIME_UNIT_days: '${days} days',
	TIME_UNIT_hour: '1 hour',
	TIME_UNIT_hours: '${hours} hours',
	TIME_UNIT_minute: '1 minute',
	TIME_UNIT_minutes: '${minutes} minutes'
};

test('formats account age to minutes without seconds', () => {
	const get_lang_string = key => language[key];
	const age = (2 * 365 + 33) * 24 * 60 * 60 * 1000 + 18 * 60 * 60 * 1000 + 8 * 60 * 1000 + 50 * 1000;

	assert.equal(format_account_age(age, 'en', get_lang_string), '2 years, 33 days, 18 hours, 8 minutes');
	assert.equal(format_account_age(0, 'en', get_lang_string), '0 minutes');
	assert.equal(format_account_age(age + 60 * 1000 - 1, 'en', get_lang_string), '2 years, 33 days, 18 hours, 9 minutes');
	assert.equal(format_account_age(-1, 'en', get_lang_string), '');
});

test('uses Chinese unit formatting without English list punctuation', () => {
	const chinese = {
		TIME_UNIT_year: '1 年',
		TIME_UNIT_years: '${years} 年',
		TIME_UNIT_day: '1 天',
		TIME_UNIT_days: '${days} 天',
		TIME_UNIT_hour: '1 小时',
		TIME_UNIT_hours: '${hours} 小时',
		TIME_UNIT_minute: '1 分钟',
		TIME_UNIT_minutes: '${minutes} 分钟'
	};
	const age = (2 * 365 + 33) * 24 * 60 * 60 * 1000 + 18 * 60 * 60 * 1000 + 8 * 60 * 1000;

	assert.equal(format_account_age(age, 'zh-CN', key => chinese[key]), '2 年33 天18 小时8 分钟');
});
