import type { Model } from "../../domain/valuation";
import { PlayerPhoto } from "../../ui/PlayerPhoto";
import { usePopovers } from "../../ui/popover/PopoverStack";

export function SimulationIssuePopover({
  simulation,
  onApplyDrop,
  onSwitchToLive,
  close,
}: {
  simulation: NonNullable<Model["simulation"]>;
  onApplyDrop?: (team: string, playerId: string) => void;
  onSwitchToLive?: () => void;
  close: () => void;
}) {
  const issues = simulation.structuredIssues ?? [];

  return (
    <div className="gd-popover-body gd-sim-popover-body">
      <h2>Simulation: {simulation.scenario.name}</h2>
      {issues.length === 0 ? (
        <p className="gd-muted">
          All roster and position limits are satisfied in this simulation.
        </p>
      ) : (
        <div className="gd-sim-issues">
          {issues.map((issue, idx) => (
            <div
              key={`${issue.team}-${issue.rule}-${idx}`}
              className="gd-sim-issue-card"
            >
              <p className="gd-sim-issue-msg">{issue.message}</p>
              {issue.suggestedDrop && (
                <div className="gd-sim-drop-row">
                  <PlayerPhoto player={issue.suggestedDrop} size={36} />
                  <div className="gd-sim-drop-info">
                    <strong>{issue.suggestedDrop.name}</strong>
                    <small>
                      {issue.suggestedDrop.pos} ·{" "}
                      {issue.suggestedDrop.nfl ?? "FA"} · Bench player
                    </small>
                  </div>
                  {onApplyDrop && (
                    <button
                      type="button"
                      className="gd-pill gd-pill-primary"
                      onClick={() => {
                        onApplyDrop(issue.team, issue.suggestedDrop!.id);
                        close();
                      }}
                    >
                      Apply suggested drop
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="gd-sim-actions">
        <a href="#/roster" className="gd-pill" onClick={close}>
          Open simulation
        </a>
        {onSwitchToLive && (
          <button
            type="button"
            className="gd-pill"
            onClick={() => {
              onSwitchToLive();
              close();
            }}
          >
            Switch to live roster
          </button>
        )}
      </div>
    </div>
  );
}

// One-line note for screens that use a team affected by an active simulation issue.
export function SimulationNote({
  simulation,
  team,
  onApplyDrop,
  onSwitchToLive,
}: {
  simulation?: Model["simulation"] | null;
  team?: string | string[];
  onApplyDrop?: (team: string, playerId: string) => void;
  onSwitchToLive?: () => void;
}) {
  const popovers = usePopovers();
  if (!simulation?.structuredIssues || simulation.structuredIssues.length === 0) {
    return null;
  }
  const teamIssues = simulation.structuredIssues.filter((i) => {
    if (!team) return true;
    if (Array.isArray(team)) return team.includes(i.team);
    return i.team === team;
  });
  if (teamIssues.length === 0) return null;

  const first = teamIssues[0];
  const openPopover = () => {
    popovers.open({
      title: `Simulation: ${simulation.scenario.name}`,
      width: 480,
      render: (close) => (
        <SimulationIssuePopover
          simulation={simulation}
          onApplyDrop={onApplyDrop}
          onSwitchToLive={onSwitchToLive}
          close={close}
        />
      ),
    });
  };

  return (
    <div className="gd-simulation-note" role="alert">
      <span>⚠️ {first.message}</span>
      <button
        type="button"
        className="gd-pill"
        onClick={openPopover}
        style={{ marginLeft: "auto", flexShrink: 0 }}
      >
        Review fix
      </button>
    </div>
  );
}
