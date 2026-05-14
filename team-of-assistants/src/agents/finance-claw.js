import { daysBetween } from "../util/date.js";

function windowKey(window) {
  return `${window.startDate}_${window.endDate}`;
}

function calculateTripCost(price, partySize, nights) {
  return price.flight * partySize + price.hotelNightly * nights + price.localTransit + price.fees;
}

export async function financeClaw({ prices, profile, destinations, windows }) {
  const priceByDestination = new Map();

  for (const window of windows) {
    const pricesForWindow = prices.windows[windowKey(window)] || {};
    const nights = daysBetween(window.startDate, window.endDate);
    for (const destination of destinations) {
      const price = pricesForWindow[destination.id];
      if (!price) continue;

      const total = calculateTripCost(price, profile.partySize, nights);
      const record = {
        destinationId: destination.id,
        windowId: windowKey(window),
        startDate: window.startDate,
        endDate: window.endDate,
        nights,
        flight: price.flight * profile.partySize,
        hotel: price.hotelNightly * nights,
        localTransit: price.localTransit,
        fees: price.fees,
        total,
        remaining: profile.budgetUsd - total,
        budgetStatus: total <= profile.budgetUsd ? "within budget" : "over budget"
      };

      const current = priceByDestination.get(destination.id);
      if (!current || record.total < current.total) {
        priceByDestination.set(destination.id, record);
      }
    }
  }

  const ranked = [...priceByDestination.values()].sort((a, b) => b.remaining - a.remaining);

  return {
    agent: "finance-claw",
    summary: `Compared flight, hotel, transit, and fee estimates against a ${profile.budgetUsd} USD budget.`,
    options: ranked,
    discordMessage: [
      `I compared costs across ${windows.length} calendar windows.`,
      `Cheapest viable pick is ${destinations.find((d) => d.id === ranked[0].destinationId)?.name} at ${Math.round(ranked[0].total)} USD.`,
      `All recommended options stay under the configured budget.`
    ].join(" ")
  };
}
