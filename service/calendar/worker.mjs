import data from '../../static/calendar-reminders/calendar-data.json' with {type: 'json'};
import {validateSettings, selectOccurrences, exportICS} from '../../static/calendar-reminders/core.mjs';
import {createCalendarService} from './service.mjs';
import release from './release.json' with {type: 'json'};

export default createCalendarService({
  getData: () => data, getRelease: () => release, validateSettings, selectOccurrences, exportICS
});
