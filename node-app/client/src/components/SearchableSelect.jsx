import React, { useEffect, useMemo, useRef, useState } from "react";

const normalize = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("pt-BR");

export default function SearchableSelect({
  value,
  onChange,
  onQuery,
  options = [],
  placeholder = "Selecione",
  emptyLabel = "Nenhuma opção encontrada",
  disabled = false,
  remote = false,
  maxVisible = 40,
}) {
  const rootRef = useRef(null);
  const selected = options.find((option) => String(option.value) === String(value ?? ""));
  const [query, setQuery] = useState(selected?.label || "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) setQuery(selected?.label || "");
  }, [selected?.label, open]);

  const filtered = useMemo(() => {
    const source = options.filter((option) => option.label || option.value === "");
    if (remote) return source.slice(0, maxVisible);
    const term = normalize(query);
    const matches = !term || selected?.label === query
      ? source
      : source.filter((option) => normalize(option.label).includes(term));
    return matches.slice(0, maxVisible);
  }, [options, query, selected?.label, remote, maxVisible]);

  function choose(option) {
    onChange(option?.value ?? "");
    setQuery(option?.label || "");
    setOpen(false);
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && filtered[active]) {
      event.preventDefault();
      choose(filtered[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery(selected?.label || "");
    }
  }

  return (
    <div className={`searchable-select ${open ? "open" : ""}`} ref={rootRef}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          setActive(0);
          onQuery?.(query);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
          onQuery?.(event.target.value);
          if (!event.target.value) onChange("");
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          window.setTimeout(() => {
            if (!rootRef.current?.contains(document.activeElement)) {
              setOpen(false);
              setQuery(selected?.label || "");
            }
          }, 100);
        }}
      />
      <span className="searchable-select-arrow" aria-hidden="true">⌄</span>
      {open && (
        <div className="searchable-select-options" role="listbox">
          {filtered.length ? filtered.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={String(option.value) === String(value ?? "")}
              className={index === active ? "active" : ""}
              key={`${option.value}-${index}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(option)}
            >
              {option.label}
            </button>
          )) : <div className="searchable-select-empty">{emptyLabel}</div>}
        </div>
      )}
    </div>
  );
}
