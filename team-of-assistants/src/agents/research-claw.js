function scoreDestination(destination, interests) {
  const interestHits = destination.tags.filter((tag) => interests.includes(tag)).length;
  const rainPenalty = destination.weather.rainChancePct > 25 ? -2 : destination.weather.rainChancePct > 15 ? -0.5 : 0;
  const comfortScore = destination.weather.highF >= 62 && destination.weather.highF <= 82 ? 2 : 0.5;
  return interestHits * 2 + comfortScore + rainPenalty;
}

export async function researchClaw({ destinations, profile, intent }) {
  const ranked = destinations
    .map((destination) => ({
      ...destination,
      researchScore: scoreDestination(destination, profile.interests),
      matchedInterests: destination.tags.filter((tag) => profile.interests.includes(tag))
    }))
    .sort((a, b) => b.researchScore - a.researchScore);

  return {
    agent: "research-claw",
    summary: `Found ${ranked.length} destination candidates for ${intent.tripLengthDays}-day PTO windows, ranked by weather and interests.`,
    candidates: ranked,
    discordMessage: [
      "I found warm, low-friction destinations that match food, art, walkability, and light hiking.",
      `Top weather fit: ${ranked[0].name} (${ranked[0].weather.summary}, ${ranked[0].weather.highF}F high).`,
      `Best interest overlap: ${ranked[0].matchedInterests.join(", ")}.`
    ].join(" ")
  };
}
