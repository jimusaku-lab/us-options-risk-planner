# Synthetic Forward partial-close leg history

For an active synthetic forward, the dashboard derives a history row from a
confirmed close execution and its option leg. It does not create or persist a
second simulation. The still-open parent remains in current management and
only its remaining leg is eligible for current-price evaluation and a close
decision action.

- A row is emitted only for a valid, confirmed, non-over-close execution on an
  active synthetic parent with a partial formal close completion.
- The stable display identity is parent simulation, leg, and confirmed
  execution identities. Multiple fills are one leg summary with execution
  detail; unknown legs, drafts, duplicates, and invalid quantities are not
  history.
- When both legs are formally complete, only the ended parent is shown. No
  separate derived leg row is emitted.
- Yearly and tax summaries include each confirmed execution once when it is
  confirmed, including partial composites. They never add it again when the
  parent becomes terminal.
- Selecting a derived row opens the exact existing close execution in the
  parent record. It performs no broker write and changes no stored execution.
