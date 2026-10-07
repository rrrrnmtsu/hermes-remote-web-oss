import type {
  IntervalUnit,
  ScheduleBuilderState,
  ScheduleMode,
  Weekday,
} from '@hermes-pwa/core';
import { WEEKDAY_INDEXES, buildScheduleString } from '@hermes-pwa/core';

interface ScheduleBuilderProps {
  value: ScheduleBuilderState;
  onChange: (value: ScheduleBuilderState) => void;
}

const MODE_LABEL: Record<ScheduleMode, string> = {
  interval: 'Interval',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  once: 'Once',
  custom: 'Custom',
};

const WEEKDAY_LABEL: Record<Weekday, string> = {
  0: 'Su',
  1: 'Mo',
  2: 'Tu',
  3: 'We',
  4: 'Th',
  5: 'Fr',
  6: 'Sa',
};

export function ScheduleBuilder({ value, onChange }: ScheduleBuilderProps) {
  const update = (patch: Partial<ScheduleBuilderState>) => {
    onChange({ ...value, ...patch });
  };

  const toggleWeekday = (day: Weekday) => {
    const present = value.weekdays.includes(day);
    update({
      weekdays: present ? value.weekdays.filter((d) => d !== day) : [...value.weekdays, day],
    });
  };

  const preview = buildScheduleString(value);

  return (
    <div className="hm-schedule">
      <div className="hm-projects__field">
        <label className="hm-projects__label">Schedule mode</label>
        <select
          className="hm-select"
          value={value.mode}
          onChange={(e) => update({ mode: e.target.value as ScheduleMode })}
        >
          {Object.entries(MODE_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {value.mode === 'interval' && (
        <div className="hm-projects__form-row">
          <div className="hm-projects__field">
            <label className="hm-projects__label">Every</label>
            <input
              type="number"
              className="hm-input"
              min={1}
              max={9999}
              value={String(value.intervalValue)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                update({ intervalValue: Number.isFinite(n) && n > 0 ? n : 1 });
              }}
            />
          </div>
          <div className="hm-projects__field">
            <label className="hm-projects__label">Unit</label>
            <select
              className="hm-select"
              value={value.intervalUnit}
              onChange={(e) => update({ intervalUnit: e.target.value as IntervalUnit })}
            >
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </div>
        </div>
      )}

      {(value.mode === 'daily' || value.mode === 'weekly' || value.mode === 'monthly') && (
        <div className="hm-projects__field">
          <label className="hm-projects__label">Time</label>
          <input
            type="time"
            className="hm-input"
            value={value.timeOfDay}
            onChange={(e) => update({ timeOfDay: e.target.value })}
          />
        </div>
      )}

      {value.mode === 'weekly' && (
        <div className="hm-projects__field">
          <label className="hm-projects__label">Weekdays</label>
          <div className="hm-schedule__weekdays" role="group" aria-label="Weekdays">
            {WEEKDAY_INDEXES.map((d) => {
              const on = value.weekdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  className={`hm-schedule__weekday ${on ? 'hm-schedule__weekday--on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleWeekday(d)}
                >
                  {WEEKDAY_LABEL[d]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {value.mode === 'monthly' && (
        <div className="hm-projects__field">
          <label className="hm-projects__label">Day of month</label>
          <input
            type="number"
            className="hm-input"
            min={1}
            max={31}
            value={String(value.dayOfMonth)}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              update({ dayOfMonth: Number.isFinite(n) && n >= 1 && n <= 31 ? n : 1 });
            }}
          />
        </div>
      )}

      {value.mode === 'once' && (
        <div className="hm-projects__field">
          <label className="hm-projects__label">Run at</label>
          <input
            type="datetime-local"
            className="hm-input"
            value={value.onceAt}
            onChange={(e) => update({ onceAt: e.target.value })}
          />
        </div>
      )}

      {value.mode === 'custom' && (
        <div className="hm-projects__field">
          <label className="hm-projects__label">Cron expression</label>
          <input
            type="text"
            className="hm-input hm-mono"
            placeholder="0 9 * * *"
            value={value.custom}
            onChange={(e) => update({ custom: e.target.value })}
          />
          <p className="hm-note">5-field cron expression, e.g. 30 14 * * 1,3,5</p>
        </div>
      )}

      {preview && (
        <p className="hm-note">
          <span className="hm-muted">Preview: </span>
          <code className="hm-mono">{preview}</code>
        </p>
      )}
    </div>
  );
}
