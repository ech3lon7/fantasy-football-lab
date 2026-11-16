import { usePopovers } from "../../ui/popover/PopoverStack";
import { defaultFilterShortcut } from "./trade/filter-shortcut";

import { shortcuts } from "./shortcut-list";

// The list lives in its own module so the shortcut validator can read it without loading this screen.
export { shortcuts };

// Opens the keyboard reference; shared by the header menu and the Lab so both open the same popover.
export function useKeyboardReference(shortcut = defaultFilterShortcut) {
  const popovers = usePopovers();
  return () =>
    popovers.open({
      title: "Keyboard reference",
      width: 560,
      render: () => <KeyboardReference shortcut={shortcut} />,
    });
}

// The keyboard reference popover; its second popover demonstrates that Escape peels back one layer at a time.
function KeyboardReference({ shortcut }: { shortcut: string }) {
  const popovers = usePopovers();
  return (
    <div className="gd-popover-body">
      <h2>Keyboard reference</h2>
      <KeyboardList shortcut={shortcut} />
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
export function KeyboardList({ shortcut = defaultFilterShortcut }: { shortcut?: string }) {
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
      <div><dt><kbd>{shortcut}</kbd></dt><dd>Focus the Find trades filter wheel.</dd></div>
    </dl>
  );
}
