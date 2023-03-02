# Recipe Tests

## Don't display if nothing to display

When only one keyboard or only one input source is available, the UI MUST not be modified, unless user set the 'always display menu item' in config (default false).

| Steps | Expected |
|---|---|
| only one input source available | nothing is displayed (the input source indicator is and stay hidden) |
| plug a keyboard in | nothing is displayed |


## Detect plugged keyboard

When a new keyboard is plugged in (i.e. there was at least one detected) and several input source are defined, it should appears on the menu item.

| Steps | Expected |
|---|---|
| Several input sources available | |
| plug a keyboard in | an item appears on the Keyboard sub-menu, with a name corresponing to the new keyboard |
| plug the keyboard out | the item disapears |


## Associating a keyboard

When menu item corresponding to a keyboard is clicked, is becomes associated to the current input source.

Associated keyboard stay on the menu even if unplugged. Clicking menu item of an associated keyboard de-associate it.

| Steps | Expected |
|---|---|
| Several input sources available | |
| plug a keyboard in | an item appears on the Keyboard sub-menu, with a name corresponing to the new keyboard |
| click the menu item | the short name of the current input source is appended to the menu item, configuration value is added | 
| plug the keyboard out | the item is in italics |
| click the menu item | the item disapear, configuration value is removed |


## Selecting input source when a keyboard is detected

Every time a keyboard is associated to an input source and plugged, and that input source is selected, that keyboard MUST be selected.
If several keyboard meet that rule, one of those with highest priority must be selected.

When entering a session, the plugged keyboard with the highest priority is selected as current, and the corresponding input source is activated.