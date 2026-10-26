// Device date and reminder zone are deliberately independent.
export function deviceDate(instant = new Date()) {
  return `${instant.getFullYear()}-${String(instant.getMonth()+1).padStart(2,'0')}-${String(instant.getDate()).padStart(2,'0')}`;
}
export function nextLocalMidnight(instant = new Date()) {
  const next = new Date(instant); next.setHours(24,0,0,50);
  return Math.max(50,next.getTime()-instant.getTime());
}
export function changedDeviceZone(previous, current, reminder) {
  return Boolean(previous && current && previous !== current && current !== reminder);
}
