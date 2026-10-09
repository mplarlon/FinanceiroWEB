import { useEffect } from "react";

const DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/;

function normalizedText(cell) {
  return (cell?.innerText || cell?.textContent || "").replace(/\s+/g, " ").trim();
}

function sortableValue(cell) {
  const value = normalizedText(cell);
  if (!value || value === "—" || value === "-") return { kind: "empty", value: "" };

  const dateMatch = value.match(DATE_PATTERN);
  if (dateMatch) {
    const [, day, month, year, hour = "00", minute = "00"] = dateMatch;
    return { kind: "number", value: Number(`${year}${month}${day}${hour}${minute}`) };
  }

  const numeric = value
    .replace(/R\$\s*/gi, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".")
    .replace(/%$/, "");
  if (/^[+-]?\d+(?:\.\d+)?$/.test(numeric)) {
    return { kind: "number", value: Number(numeric) };
  }

  return { kind: "text", value };
}

function compareCells(leftCell, rightCell, direction) {
  const left = sortableValue(leftCell);
  const right = sortableValue(rightCell);
  if (left.kind === "empty" && right.kind !== "empty") return 1;
  if (right.kind === "empty" && left.kind !== "empty") return -1;

  const comparison = left.kind === "number" && right.kind === "number"
    ? left.value - right.value
    : String(left.value).localeCompare(String(right.value), "pt-BR", {
      numeric: true,
      sensitivity: "base",
    });
  return direction === "ascending" ? comparison : -comparison;
}

function isSortableHeader(header) {
  const text = normalizedText(header).toLocaleLowerCase("pt-BR");
  return Boolean(text)
    && !header.querySelector("input, button, select")
    && !["ações", "acao", "ação"].includes(text);
}

function markSortableHeaders(root = document) {
  root.querySelectorAll?.("table.tabela thead th").forEach((header) => {
    header.classList.toggle("global-sortable", isSortableHeader(header));
    if (isSortableHeader(header) && !header.title) {
      header.title = "Clique para ordenar";
    }
  });
}

export default function GlobalTableSorting() {
  useEffect(() => {
    markSortableHeaders();
    const observer = new MutationObserver(() => markSortableHeaders());
    observer.observe(document.getElementById("root"), { childList: true, subtree: true });

    function handleClick(event) {
      const header = event.target.closest("table.tabela thead th.global-sortable");
      if (!header) return;

      const table = header.closest("table");
      const columnIndex = Array.from(header.parentElement.children).indexOf(header);
      const direction = header.getAttribute("aria-sort") === "ascending"
        ? "descending"
        : "ascending";

      table.querySelectorAll("thead th.global-sortable").forEach((item) => {
        item.removeAttribute("aria-sort");
        item.classList.remove("is-sorted");
      });
      header.setAttribute("aria-sort", direction);
      header.classList.add("is-sorted");

      table.querySelectorAll("tbody").forEach((body) => {
        const rows = Array.from(body.rows);
        rows.sort((left, right) => compareCells(
          left.cells[columnIndex],
          right.cells[columnIndex],
          direction,
        ));
        rows.forEach((row) => body.appendChild(row));
      });
    }

    document.addEventListener("click", handleClick);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", handleClick);
    };
  }, []);

  return null;
}
