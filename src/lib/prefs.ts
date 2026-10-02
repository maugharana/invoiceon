import { setDateFormat } from '../../shared/gst';
import { api } from './api';
import { useQuery } from './data';

/** Loads the settings and applies the look-and-wording ones that act globally (the date format). Returns the settings once they've arrived. */
export function useApplyPreferences() {
  const settings = useQuery(() => api.getSettings());
  if (settings.data) setDateFormat(settings.data.dateFormat);
  return settings.data;
}
