/**
 * Controlled editing controls for the work item preview: the reason/state/
 * priority/assignee/custom-field pickers and their shared bits (outside-pointer
 * close hook, query highlighting, avatar). All are presentational — data and
 * mutations are passed in via props — so they live apart from the panel that
 * owns the state and queries.
 *
 * Implementation is split across sibling modules:
 *   PreviewEditorsBase.tsx     — hook, text editors, highlight helpers, avatar
 *   PreviewEditorsPickers.tsx  — CustomFieldPicker, StatePicker, ClassificationPicker, PriorityPicker
 *   PreviewEditorsAssignee.tsx — AssigneePicker
 */

export {
  useCloseOnOutsidePointer,
  TitleEditor,
  ReasonEditor,
  splitMatchSegments,
  HighlightedText,
  CandidateAvatar,
} from "./PreviewEditorsBase";

export {
  CustomFieldPicker,
  StatePicker,
  ClassificationPicker,
  PriorityPicker,
} from "./PreviewEditorsPickers";

export { AssigneePicker } from "./PreviewEditorsAssignee";
