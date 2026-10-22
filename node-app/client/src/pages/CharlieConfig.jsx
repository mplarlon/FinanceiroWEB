import React from "react";
import CafeManha from "./CafeManha.jsx";
import { MonitorSettings } from "./CharlieAlerts.jsx";
import { DirectorPreferences } from "./CharlieDirector.jsx";

export default function CharlieConfig({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="charlie-modal-backdrop">
      <section className="charlie-modal charlie-config-panel" role="dialog" aria-modal="true" aria-label="Configuração">
        <header>
          <div>
            <h2>Configuração</h2>
            <small>Agenda, metas, alertas e preferências do Charlie ficam neste lugar.</small>
          </div>
          <button type="button" onClick={onClose}>Fechar</button>
        </header>
        <div className="charlie-config-sections">
          <CafeManha open embedded variant="settings" />
          <section className="panel">
            <h2>Alertas</h2>
            <MonitorSettings />
          </section>
          <section className="panel">
            <h2>Modo Diretor</h2>
            <DirectorPreferences />
          </section>
        </div>
      </section>
    </div>
  );
}
