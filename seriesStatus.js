// A completed series becomes active only after a later, unwatched regular episode airs.
function shouldResumeSeries(item, episode, today) {
  if (item.type !== 'TV' || item.status !== 'IZLENDI' || !episode) return false;
  const season = episode.season_number, number = episode.episode_number;
  if (!Number.isInteger(season) || season < 1 || !Number.isInteger(number) || number < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(episode.air_date || '') || episode.air_date > today) return false;
  const watched = (item.watchedEpisodes || []).filter(e => Number.isInteger(e.seasonNumber) && e.seasonNumber > 0 && Number.isInteger(e.episodeNumber) && e.episodeNumber > 0);
  if (watched.some(e => e.seasonNumber === season && e.episodeNumber === number)) return false;
  if (watched.length) return watched.every(e => e.seasonNumber < season || (e.seasonNumber === season && e.episodeNumber < number));
  // Older records may lack episode selections; require evidence that the episode aired after completion.
  const completed = String(item.completedAt || item.completedDate || item.watchedAt || '').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(completed) && episode.air_date > completed;
}
module.exports = { shouldResumeSeries };
