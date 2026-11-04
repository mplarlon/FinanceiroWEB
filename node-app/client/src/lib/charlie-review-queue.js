export const REVIEW_FILTERS = [
  { id: "pending", label: "Pendentes" },
  { id: "approved", label: "Aprovados" },
  { id: "uploaded", label: "Na modulo_removido" },
  { id: "rejected", label: "Rejeitados" },
  { id: "all", label: "Todos" },
];

const PENDING = new Set(["open", "suggested", "blocked", "failed"]);

export function matchesReviewFilter(item, filter) {
  const status = item?.status || "open";
  if (filter === "approved") return status === "approved";
  if (filter === "uploaded") return status === "uploaded";
  if (filter === "rejected") return status === "rejected";
  if (filter === "all") return true;
  return PENDING.has(status);
}

export function reviewFilterCount(items, filter) {
  return (items || []).filter((item) => matchesReviewFilter(item, filter)).length;
}
