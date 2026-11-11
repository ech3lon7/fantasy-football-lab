import { usePopovers } from "../../ui/popover/PopoverStack";

// Every keyboard rule in the design, in one place so it can be opened from the header and later from Lab.
export const shortcuts: [string, string][] = [
  ["Esc", "Close the top popover only, then the one beneath."],
  ["Tab", "Stay inside an open popover."],
  ["↑ ↓", "Move between players in lists; Enter opens the card."],
  ["← →", "Step to the previous or next player in a card, keeping the tab."],
  ["← → in versus", "Swap the two sides."],
];

// The keyboard reference popover; its second popover demonstrates that Escape peels back one layer at a time.
export function KeyboardReferenceButton() {
  const popovers = usePopovers();
  return (
    <button
      type="button"
      className="gd-pill"
      onClick={() =>
        popovers.open({
          title: "Keyboard reference",
          width: 560,
          render: () => <KeyboardReference />,
        })
      }
    >
      Keys
    </button>
  );
}

function KeyboardReference() {
  const popovers = usePopovers();
  return (
    <div className="gd-popover-body">
      <h2>Keyboard reference</h2>
      <KeyboardList />
      <button
        type="button"
        className="gd-pill"
        onClick={() =>
          popovers.open({
            title: "How focus works",
            width: 460,
            render: () => (
              <div className="gd-popover-body">
                <h2>How focus works</h2>
                <p>
                  Opening a popover moves focus inside it. Closing it returns
                  focus to the control that opened it, including a row in a
                  list.
                </p>
              </div>
            ),
          })
        }
      >
        How focus works
      </button>
    </div>
  );
}

// The shortcut list, shared by the popover and the Lab page.
export function KeyboardList() {
  return (
    <dl className="gd-keys">
      {shortcuts.map(([key, what]) => (
        <div key={key}>
          <dt>
            <kbd>{key}</kbd>
          </dt>
          <dd>{what}</dd>
        </div>
      ))}
    </dl>
  );
}
