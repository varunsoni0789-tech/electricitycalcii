import React, { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "ai_energy_live_state_v1";

const DEFAULT_APPLIANCES = [
  { id: "ac", name: "Living Room Inverter AC (1.5T)", watts: 1450, on: true, category: "heavy", standbyWaste: false },
  { id: "fridge", name: "Smart Refrigerator", watts: 140, on: true, category: "essential", standbyWaste: false },
  { id: "geyser", name: "Bathroom Water Heater (Geyser)", watts: 2000, on: false, category: "heavy", standbyWaste: true },
  { id: "washer", name: "Washing Machine", watts: 520, on: false, category: "shiftable", standbyWaste: false },
  { id: "entertainment", name: "TV + Console + Desktop Standby", watts: 185, on: true, category: "standby", standbyWaste: true },
  { id: "lights", name: "Home LED Lighting & Fans", watts: 210, on: true, category: "essential", standbyWaste: false },
];

function getTariffPeriod(hour) {
  if (hour >= 18 && hour <= 22) {
    return { label: "Peak Hours (18:00–22:00)", multiplier: 1.35, isPeak: true };
  }
  if (hour >= 0 && hour < 6) {
    return { label: "Off-Peak Night (00:00–06:00)", multiplier: 0.85, isPeak: false };
  }
  return { label: "Standard Hours", multiplier: 1.0, isPeak: false };
}

export default function App() {
  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      return null;
    }
  }, []);

  const [appliances, setAppliances] = useState(saved?.appliances || DEFAULT_APPLIANCES);
  const [baseTariff, setBaseTariff] = useState(saved?.baseTariff || 7.5);
  const [simulatedHour, setSimulatedHour] = useState(() => new Date().getHours());
  const [autoOptimize, setAutoOptimize] = useState(false);
  const [isRunning, setIsRunning] = useState(true);
  const [totalSessionKwh, setTotalSessionKwh] = useState(saved?.totalSessionKwh || 14.82);

  // Live 1-second telemetry history (last 45 ticks)
  const [history, setHistory] = useState(() =>
    Array.from({ length: 30 }, (_, idx) => ({
      time: `-${30 - idx}s`,
      watts: 1950 + Math.round(Math.sin(idx / 3) * 80),
      isSpike: false,
    }))
  );

  const [alerts, setAlerts] = useState([
    {
      id: "init-1",
      time: new Date().toLocaleTimeString(),
      message: "AI Baseline Calibrated: Monitoring live voltage, current, and appliance signatures.",
      watts: 1985,
    },
  ]);

  const [newAppName, setNewAppName] = useState("");
  const [newAppWatts, setNewAppWatts] = useState(300);
  const [newAppCategory, setNewAppCategory] = useState("shiftable");

  // Save state automatically
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ appliances, baseTariff, totalSessionKwh })
    );
  }, [appliances, baseTariff, totalSessionKwh]);

  const tariffInfo = getTariffPeriod(simulatedHour);
  const effectiveTariff = Number((baseTariff * tariffInfo.multiplier).toFixed(2));

  // Real-time 1-second smart meter tick
  useEffect(() => {
    if (!isRunning) return;

    const timer = setInterval(() => {
      const activeWatts = appliances.reduce((sum, a) => (a.on ? sum + a.watts : sum), 0);
      // Realistic small grid fluctuation (+/- 2.5%)
      const jitter = Math.round((Math.random() - 0.5) * Math.max(12, activeWatts * 0.04));
      const liveWatts = Math.max(15, activeWatts + jitter);

      // Integrate kWh (accelerated 60x so user can watch kWh & bill tick live in real time)
      const kwhIncrement = (liveWatts / 1000) * (60 / 3600);
      setTotalSessionKwh((prev) => Number((prev + kwhIncrement).toFixed(4)));

      const isSpike = liveWatts > 2600 || (tariffInfo.isPeak && liveWatts > 1800);
      const nowStr = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      setHistory((prev) => [
        ...prev.slice(-44),
        { time: nowStr, watts: liveWatts, isSpike },
      ]);
    }, 1000);

    return () => clearInterval(timer);
  }, [isRunning, appliances, tariffInfo.isPeak]);

  // AI Auto-Optimizer: automatically shuts off wasteful standby/heavy loads when enabled
  useEffect(() => {
    if (!autoOptimize) return;

    setAppliances((prev) => {
      let changed = false;
      const updated = prev.map((app) => {
        if (!app.on) return app;
        const isNight = simulatedHour >= 0 && simulatedHour < 6;
        if (app.category === "standby" && (isNight || tariffInfo.isPeak)) {
          changed = true;
          return { ...app, on: false };
        }
        if (app.category === "shiftable" && tariffInfo.isPeak) {
          changed = true;
          return { ...app, on: false };
        }
        if (app.id === "geyser" && app.on) {
          changed = true;
          return { ...app, on: false };
        }
        return app;
      });

      if (changed) {
        setAlerts((prevAlerts) => [
          {
            id: `opt-${Date.now()}`,
            time: new Date().toLocaleTimeString(),
            message: `AI Auto-Optimizer turned off non-essential/peak loads (${tariffInfo.label}).`,
            watts: updated.reduce((s, a) => (a.on ? s + a.watts : s), 0),
          },
          ...prevAlerts.slice(0, 9),
        ]);
      }
      return changed ? updated : prev;
    });
  }, [autoOptimize, simulatedHour, tariffInfo.isPeak, tariffInfo.label]);

  const currentWatts = history[history.length - 1]?.watts || 0;
  const voltage = Number((231.4 - (currentWatts / 4000) * 6.5).toFixed(1));
  const currentAmps = Number((currentWatts / Math.max(200, voltage)).toFixed(2));
  const hourlyCostInr = Number(((currentWatts / 1000) * effectiveTariff).toFixed(2));

  // AI Forecast & Monthly Projection
  const projectedDailyKwh = Number(((currentWatts / 1000) * 14.5 + 4.2).toFixed(2));
  const projectedMonthlyBill = Math.round(projectedDailyKwh * 30 * baseTariff);

  // Dynamic AI Recommendations based on ACTUAL running appliances
  const liveRecommendations = useMemo(() => {
    const list = [];
    const geyserOn = appliances.find((a) => a.id === "geyser" && a.on);
    const standbyOn = appliances.filter((a) => a.on && (a.category === "standby" || a.standbyWaste));
    const heavyOnPeak = appliances.filter(
      (a) => a.on && tariffInfo.isPeak && (a.category === "heavy" || a.category === "shiftable")
    );

    if (geyserOn) {
      list.push({
        id: "rec-geyser",
        title: "High-Draw Water Heater Running",
        detail: `${geyserOn.name} is drawing ${geyserOn.watts}W continuously (₹${(
          (geyserOn.watts / 1000) *
          effectiveTariff
        ).toFixed(1)}/hr).`,
        actionLabel: "Turn Off Geyser Now",
        savingsLabel: "Save ~₹1,350/mo",
        urgent: true,
        onFix: () => toggleAppliance(geyserOn.id),
      });
    }

    if (heavyOnPeak.length > 0) {
      const totalPeakW = heavyOnPeak.reduce((s, a) => s + a.watts, 0);
      list.push({
        id: "rec-peak",
        title: "Peak-Tariff Overload Detected",
        detail: `${heavyOnPeak.length} heavy appliance(s) drawing ${totalPeakW}W during ${tariffInfo.label} (1.35x rate).`,
        actionLabel: "Shed Peak Loads",
        savingsLabel: `Save ~₹${Math.round((totalPeakW / 1000) * baseTariff * 60)}/mo`,
        urgent: true,
        onFix: () => {
          setAppliances((prev) =>
            prev.map((a) =>
              tariffInfo.isPeak && (a.category === "heavy" || a.category === "shiftable")
                ? { ...a, on: false }
                : a
            )
          );
        },
      });
    }

    if (standbyOn.length > 0) {
      const standbyW = standbyOn.reduce((s, a) => s + a.watts, 0);
      list.push({
        id: "rec-standby",
        title: "Vampire / Standby Load Detected",
        detail: `${standbyOn.map((a) => a.name).join(", ")} consuming ${standbyW}W in idle/standby mode.`,
        actionLabel: "Cut Standby Power",
        savingsLabel: `Save ~₹${Math.round((standbyW / 1000) * baseTariff * 240)}/mo`,
        urgent: false,
        onFix: () => {
          setAppliances((prev) =>
            prev.map((a) => (a.category === "standby" || a.standbyWaste ? { ...a, on: false } : a))
          );
        },
      });
    }

    if (list.length === 0) {
      list.push({
        id: "rec-optimal",
        title: "Consumption Optimal",
        detail: "No wasteful standby or peak-tariff anomalies detected right now.",
        actionLabel: "Optimal ✓",
        savingsLabel: "Running at peak efficiency",
        urgent: false,
        onFix: null,
      });
    }

    return list;
  }, [appliances, tariffInfo, effectiveTariff, baseTariff]);

  function toggleAppliance(id) {
    setAppliances((prev) =>
      prev.map((app) => {
        if (app.id !== id) return app;
        const nextOn = !app.on;
        if (nextOn && (app.watts >= 1400 || tariffInfo.isPeak)) {
          setAlerts((old) => [
            {
              id: `sp-${Date.now()}`,
              time: new Date().toLocaleTimeString(),
              message: `Load Spike: "${app.name}" switched ON (+${app.watts}W) during ${tariffInfo.label}.`,
              watts: app.watts,
            },
            ...old.slice(0, 9),
          ]);
        }
        return { ...app, on: nextOn };
      })
    );
  }

  function handleAddAppliance(e) {
    e.preventDefault();
    if (!newAppName.trim()) return;
    const wattsNum = Math.max(5, Math.min(10000, Number(newAppWatts) || 100));
    setAppliances((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        name: newAppName.trim(),
        watts: wattsNum,
        on: true,
        category: newAppCategory,
        standbyWaste: newAppCategory === "standby",
      },
    ]);
    setNewAppName("");
  }

  const maxChartWatts = Math.max(...history.map((h) => h.watts), 1000);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="live-pill">
            <span className="pulse-dot" />
            {isRunning ? "SMART METER STREAMING LIVE (1s)" : "METER PAUSED"}
          </div>
          <h1>AI Energy Management System</h1>
          <p>
            Real-time smart meter telemetry, appliance load control, waste detection & AI auto-optimization
          </p>
        </div>

        <div className="controls">
          <label className="field">
            <span>Time of Day (ToU)</span>
            <select
              value={simulatedHour}
              onChange={(e) => setSimulatedHour(Number(e.target.value))}
            >
              <option value={2}>02:00 (Night Off-Peak)</option>
              <option value={10}>10:00 (Morning Standard)</option>
              <option value={15}>15:00 (Afternoon Standard)</option>
              <option value={20}>20:00 (Evening Peak 1.35x)</option>
            </select>
          </label>

          <label className="field">
            <span>Base Tariff (₹/kWh)</span>
            <input
              type="number"
              min="1"
              max="50"
              step="0.5"
              value={baseTariff}
              onChange={(e) => setBaseTariff(Math.max(1, Number(e.target.value) || 7.5))}
            />
          </label>

          <button
            type="button"
            className={`btn ${autoOptimize ? "btn-primary" : ""}`}
            onClick={() => setAutoOptimize((v) => !v)}
          >
            {autoOptimize ? "AI Auto-Save: ON ✓" : "Enable AI Auto-Save"}
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => setIsRunning((r) => !r)}
          >
            {isRunning ? "Pause" : "Resume"}
          </button>
        </div>
      </header>

      {/* Live Smart Meter Telemetry Strip */}
      <section className="meter-strip">
        <div className={`meter-box ${currentWatts > 2500 ? "alert-border" : ""}`}>
          <div className="meter-label">Live Power Draw</div>
          <div className="meter-val">{currentWatts.toLocaleString()} W</div>
          <div className="meter-sub">
            {voltage} V • {currentAmps} A
          </div>
        </div>

        <div className="meter-box">
          <div className="meter-label">Live Burn Rate</div>
          <div className="meter-val">₹{hourlyCostInr}/hr</div>
          <div className="meter-sub">
            Tariff: ₹{effectiveTariff}/kWh ({tariffInfo.isPeak ? "Peak" : "Normal"})
          </div>
        </div>

        <div className="meter-box">
          <div className="meter-label">Cumulative Meter</div>
          <div className="meter-val">{totalSessionKwh.toFixed(3)} kWh</div>
          <div className="meter-sub">Est. Cost: ₹{(totalSessionKwh * baseTariff).toFixed(2)}</div>
        </div>

        <div className="meter-box">
          <div className="meter-label">AI Next-Day Forecast</div>
          <div className="meter-val">{projectedDailyKwh} kWh</div>
          <div className="meter-sub">
            Est. Monthly Bill: <span className="warn">₹{projectedMonthlyBill}</span>
          </div>
        </div>
      </section>

      {/* Live Waveform & Appliance Load Disaggregation */}
      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <h2>Live Smart Meter Load Feed (Watts)</h2>
            <span className="app-meta">
              {currentWatts > 2500 ? (
                <span className="bad">High Load Spike Detected</span>
              ) : (
                <span className="good">Grid Load Normal</span>
              )}
            </span>
          </div>

          <div className="live-bars">
            {history.map((pt, i) => {
              const pct = Math.max(8, Math.round((pt.watts / maxChartWatts) * 100));
              return (
                <div
                  key={`${pt.time}-${i}`}
                  className={`live-bar ${pt.isSpike ? "spike" : ""}`}
                  style={{ height: `${pct}%` }}
                  title={`${pt.time} — ${pt.watts} W`}
                />
              );
            })}
          </div>
          <div className="app-meta" style={{ marginTop: 10 }}>
            Toggle appliances on the right to see real-time wattage response and AI anomaly detection.
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Connected Smart Loads (NILM)</h2>
            <span className="app-meta">
              {appliances.filter((a) => a.on).length}/{appliances.length} Active
            </span>
          </div>

          <div className="appliance-list">
            {appliances.map((app) => {
              const isWastefulNow =
                app.on &&
                (app.id === "geyser" ||
                  app.category === "standby" ||
                  (tariffInfo.isPeak && app.category === "shiftable"));
              return (
                <div
                  key={app.id}
                  className={`appliance-row ${app.on ? "on" : ""} ${
                    isWastefulNow ? "wasteful" : ""
                  }`}
                >
                  <div>
                    <div className="app-name">{app.name}</div>
                    <div className="app-meta">
                      {app.watts} W • {app.category}
                      {isWastefulNow && <span className="bad"> • AI Flagged Waste</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`switch-btn ${app.on ? "active" : ""}`}
                    onClick={() => toggleAppliance(app.id)}
                  >
                    {app.on ? "ON" : "OFF"}
                  </button>
                </div>
              );
            })}
          </div>

          <form className="add-form" onSubmit={handleAddAppliance}>
            <input
              type="text"
              placeholder="Add appliance (e.g., EV Charger)"
              value={newAppName}
              onChange={(e) => setNewAppName(e.target.value)}
              style={{ flex: 1, minWidth: 140 }}
            />
            <input
              type="number"
              min="5"
              max="10000"
              value={newAppWatts}
              onChange={(e) => setNewAppWatts(e.target.value)}
              style={{ width: 85 }}
              title="Watts"
            />
            <select
              value={newAppCategory}
              onChange={(e) => setNewAppCategory(e.target.value)}
            >
              <option value="shiftable">Shiftable</option>
              <option value="heavy">Heavy</option>
              <option value="standby">Standby</option>
              <option value="essential">Essential</option>
            </select>
            <button type="submit" className="btn btn-primary">
              + Add
            </button>
          </form>
        </div>
      </div>

      {/* Live Actionable AI Recommendations */}
      <div className="panel-head">
        <h2>Real-Time AI Optimization Recommendations</h2>
        <span className="app-meta">One-click automated load actions</span>
      </div>

      <section className="rec-grid">
        {liveRecommendations.map((rec) => (
          <div
            key={rec.id}
            className={`rec-card ${rec.urgent ? "urgent" : ""}`}
          >
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{rec.title}</div>
              <div className="app-meta">{rec.detail}</div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                paddingTop: 8,
                borderTop: "1px solid var(--border)",
              }}
            >
              <span className="good" style={{ fontSize: "0.84rem" }}>
                {rec.savingsLabel}
              </span>
              {rec.onFix ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={rec.onFix}
                >
                  {rec.actionLabel}
                </button>
              ) : (
                <span className="good" style={{ fontSize: "0.84rem" }}>
                  {rec.actionLabel}
                </span>
              )}
            </div>
          </div>
        ))}
      </section>

      {/* Real-Time Event Log */}
      <div className="panel-head">
        <h2>Live Smart Meter & AI Event Log</h2>
        <button
          type="button"
          className="btn"
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY);
            setAppliances(DEFAULT_APPLIANCES);
            setTotalSessionKwh(14.82);
          }}
        >
          Reset Demo Meter
        </button>
      </div>

      <div className="alert-log">
        {alerts.map((a) => (
          <div key={a.id} className="log-item">
            <span>
              <strong>[{a.time}]</strong> {a.message}
            </span>
            <span className="app-meta">Load: {a.watts} W</span>
          </div>
        ))}
      </div>
    </div>
  );
}