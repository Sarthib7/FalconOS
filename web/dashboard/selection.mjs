export function selectionAfterDispatch({ eventId, decision, selectedEvent }) {
  return decision ? eventId : selectedEvent;
}
