// ==UserScript==
// @name         IXL Cinder Solver
// @namespace    https://discord.gg/nullstate
// @version      4.2.7
// @description  v4.2.6 submit coords remeasured after scrollIntoView; crawler evidence suite
// @author       Cinder
// @match        https://*.ixl.com/*
// @match        https://www.ixl.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.openai.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─────────────────────────────────────────────
  // CONFIG
  // ─────────────────────────────────────────────
  const DEFAULTS = {
    apiKey: '',
    apiBase: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    minDelaySec: 30,
    maxDelaySec: 90,
    intentionalMissRate: 0,
    missMode: 'off',        // 'off' | 'rate' | 'count'
    missCountTarget: 0,
    doubleCheck: false,
    autoSubmit: true,
    enabled: false,
    panelVisible: true,
    typingSpeedMs: 90,
    mouseJitter: true,
    postSubmitPauseSec: 12,
    delayEnabled: true,
    preferLocalDb: true,
    localDbMinScore: 0.95,
    minConfidenceToSubmit: 0.55,
    logSource: true,
    useReasoningModel: true,
    useFewShot: true,
    useCodeCalc: true,
    useWolfram: false,
    wolframAppId: ''
  };

  function loadConfig() {
    const saved = GM_getValue('cinder_ixl_cfg', null);
    const cfg = saved ? { ...DEFAULTS, ...saved } : { ...DEFAULTS };
    // v4.2.0 full mode: respect saved autoSubmit; completion guard still gates submits
    if (cfg.missMode == null) cfg.missMode = 'off';
    if (typeof cfg.localDbMinScore !== 'number' || cfg.localDbMinScore < 0.95) {
      cfg.localDbMinScore = 0.95;
    }
    return cfg;
  }
  function saveConfig(cfg) { GM_setValue('cinder_ixl_cfg', cfg); }
  let CFG = loadConfig();

  // ═══════════════════════════════════════════════
  // QUESTION TYPES — embedded knowledge + completion
  // ═══════════════════════════════════════════════
  const QT_REGISTRY_SEED = {
  "schemaVersion": "1.0.0",
  "knowledgeVersion": "1.0.0",
  "updatedAt": "2026-10-22T13:50:00Z",
  "types": [
    {
      "id": "graph-placement",
      "name": "Graphing / Graph Placement",
      "aliases": ["graph", "coordinate", "plot"],
      "subjects": ["math-geometry"],
      "trust": "candidate",
      "confidence": 0.35,
      "detection": {
        "selectors": [".graphingPointerOverlay", "[class*=\"graphingPointer\"]", "canvas[class*=\"graph\"]", "[class*=\"coordinate\"]"],
        "requireInRoot": true,
        "minMatches": 1,
        "negativeSelectors": [],
        "textHints": ["plot", "coordinate", "graph the"]
      },
      "dom": {
        "answerControls": "canvas or overlay for point/line placement",
        "attributes": ["class*=graphing", "class*=coordinate"]
      },
      "interaction": {
        "methods": ["click"],
        "sequence": ["map coordinates to overlay", "click placement points", "verify markers"],
        "elementStrategies": ["graphingPointerOverlay bounding box + scale"]
      },
      "completionCheck": {
        "required": true,
        "checks": ["at least one placed marker visible", "no empty-required state"],
        "incompleteSignals": ["incomplete answer", "plot a point"]
      },
      "submission": {
        "buttonSelectors": ["button.submit-button", "button[class*=\"submit\"]"],
        "preSubmitVerify": true,
        "maxSubmitAttempts": 2
      },
      "recovery": {
        "onIncomplete": ["reinspect overlay", "retry placement once", "stop if still empty"],
        "maxRecoveryAttempts": 2
      },
      "failureModes": ["coordinate scale mismatch", "click not registered on canvas"],
      "testResults": [],
      "version": "1.0.0",
      "lastValidated": null,
      "notes": "Manual/unsupported for auto-solve until canvas mapping validated. Solver currently returns null."
    },
    {
      "id": "drag-drop",
      "name": "Drag and Drop",
      "aliases": ["drag", "sortable"],
      "subjects": ["math-geometry", "science-chemistry", "social-civics"],
      "trust": "tested",
      "confidence": 0.55,
      "detection": {
        "selectors": [".dragAndDropContainer", ".draggableElement", "[class*=\"dragWrapper\"]", "[class*=\"drag-drop\"]", "[draggable=\"true\"]"],
        "requireInRoot": true,
        "minMatches": 1,
        "negativeSelectors": [],
        "textHints": ["drag", "drop", "sort", "match"]
      },
      "dom": {
        "answerControls": "draggable elements + drop zones",
        "attributes": ["draggable", "class*=draggable", "class*=dropZone"]
      },
      "interaction": {
        "methods": ["drag"],
        "sequence": ["find item by text", "find zone by text", "dragstart→dragover→drop→dragend", "verify item in zone"],
        "elementStrategies": ["text match on draggableElement / dropZone"]
      },
      "completionCheck": {
        "required": true,
        "checks": ["all required items assigned", "zone occupancy reflects answer map"],
        "incompleteSignals": ["incomplete answer", "drag all items"]
      },
      "submission": {
        "buttonSelectors": ["button.submit-button"],
        "preSubmitVerify": true,
        "maxSubmitAttempts": 2
      },
      "recovery": {
        "onIncomplete": ["re-read drop zones", "retry unassigned items", "bounded stop"],
        "maxRecoveryAttempts": 2
      },
      "failureModes": ["DataTransfer ignored by React", "wrong zone match"],
      "testResults": [],
      "version": "1.0.0",
      "lastValidated": null,
      "notes": "HTML5 DragEvent sequence implemented in solver; live React acceptance not fully validated."
    },
    {
      "id": "text-highlight",
      "name": "Highlight Text / Hot Text",
      "aliases": ["hot-text", "select-words", "highlight"],
      "subjects": ["ela-grade-10", "social-civics"],
      "trust": "tested",
      "confidence": 0.6,
      "detection": {
        "selectors": [".select-words-chunk", ".select-word", "[class*=\"select-words\"]", "[class*=\"selectWords\"]", "[class*=\"SelectWords\"]"],
        "requireInRoot": true,
        "minMatches": 1,
        "negativeSelectors": [],
        "textHints": ["click the word", "highlight", "select the sentence"]
      },
      "dom": {
        "answerControls": "clickable passage chunks",
        "attributes": ["class*=select-words", "class*=selectWords"]
      },
      "interaction": {
        "methods": ["click", "highlight"],
        "sequence": ["enumerate chunks", "match answer text", "click chunk", "verify selected state"],
        "elementStrategies": ["exact then fuzzy text on select-words-chunk"]
      },
      "completionCheck": {
        "required": true,
        "checks": ["at least one chunk selected / aria-selected or selected class"],
        "incompleteSignals": ["incomplete answer", "select a word"]
      },
      "submission": {
        "buttonSelectors": ["button.submit-button"],
        "preSubmitVerify": true,
        "maxSubmitAttempts": 2
      },
      "recovery": {
        "onIncomplete": ["re-scan chunks", "re-click unmatched answers", "stop if none selected"],
        "maxRecoveryAttempts": 2
      },
      "failureModes": ["chunk text mismatch", "selection not sticky"],
      "testResults": [],
      "version": "1.0.0",
      "lastValidated": null,
      "notes": "Solver applyTextHighlight present; selection verification partial."
    },
    {
      "id": "hot-spot",
      "name": "Click a Picture or Diagram / Hot Spot",
      "aliases": ["hotspot", "image-click", "diagram-region"],
      "subjects": ["math-geometry", "science-chemistry", "social-civics"],
      "trust": "unknown",
      "confidence": 0.2,
      "detection": {
        "selectors": ["[class*=\"hotspot\"]", "[class*=\"hot-spot\"]", "svg [data-clickable]", "img[usemap]", "area[shape]"],
        "requireInRoot": true,
        "minMatches": 1,
        "negativeSelectors": [".graphingPointerOverlay"],
        "textHints": ["click the", "select the region", "which part"]
      },
      "dom": {
        "answerControls": "image map areas or SVG regions",
        "attributes": ["data-clickable", "usemap", "class*=hotspot"]
      },
      "interaction": {
        "methods": ["click"],
        "sequence": ["identify region", "click center", "verify active state"],
        "elementStrategies": ["aria-label / data attributes on regions"]
      },
      "completionCheck": {
        "required": true,
        "checks": ["region shows selected state"],
        "incompleteSignals": ["incomplete answer"]
      },
      "submission": {
        "buttonSelectors": ["button.submit-button"],
        "preSubmitVerify": true,
        "maxSubmitAttempts": 2
      },
      "recovery": {
        "onIncomplete": ["reinspect regions", "single retry", "stop"],
        "maxRecoveryAttempts": 1
      },
      "failureModes": ["invisible hit targets", "canvas-only regions"],
      "testResults": [],
      "version": "1.0.0",
      "lastValidated": null,
      "notes": "No dedicated solver path yet; falls to UNKNOWN."
    },
    {
      "id": "equation-editor",
      "name": "Equation Editor",
      "aliases": ["math-editor", "expression-entry"],
      "subjects": ["math-geometry"],
      "trust": "unknown",
      "confidence": 0.25,
      "detection": {
        "selectors": ["[class*=\"equation\"]", "[class*=\"mathquill\"]", "[class*=\"mq-\"]", "[class*=\"EquationEditor\"]", "math-field"],
        "requireInRoot": true,
        "minMatches": 1,
        "negativeSelectors": [],
        "textHints": ["enter the expression", "write the equation"]
      },
      "dom": {
        "answerControls": "custom equation editor widget",
        "attributes": ["class*=mq-", "class*=equation"]
      },
      "interaction": {
        "methods": ["type"],
        "sequence": ["focus editor", "enter expression in supported format", "verify accepted"],
        "elementStrategies": ["mathquill / contenteditable math field"]
      },
      "completionCheck": {
        "required": true,
        "checks": ["editor non-empty latex/value"],
        "incompleteSignals": ["incomplete answer"]
      },
      "submission": {
        "buttonSelectors": ["button.submit-button"],
        "preSubmitVerify": true,
        "maxSubmitAttempts": 2
      },
      "recovery": {
        "onIncomplete": ["refocus", "retype once", "stop"],
        "maxRecoveryAttempts": 1
      },
      "failureModes": ["editor ignores synthetic input", "latex vs plain mismatch"],
      "testResults": [],
      "version": "1.0.0",
      "lastValidated": null,
      "notes": "Not implemented in solver apply path."
    },
    {
      "id": "fill-in",
      "name": "Text Entry / Typed Answer",
      "aliases": ["text-entry", "typed", "number-entry"],
      "subjects": ["math-geometry", "ela-grade-10", "science-chemistry", "social-civics"],
      "trust": "validated",
      "confidence": 0.85,
      "detection": {
        "selectors": ["input.fillIn", ".fillIn input", "input[class*=\"fillIn\"]", ".science-fill-in", "input[aria-label=\"answer\"]", "input[type=\"text\"]", "input[type=\"number\"]", "textarea", "[contenteditable=\"true\"]"],
        "requireInRoot": true,
        "minMatches": 1,
        "negativeSelectors": ["input[type=\"search\"]", "input[name*=\"search\"]"],
        "textHints": []
      },
      "dom": {
        "answerControls": "visible text/number inputs or contenteditable",
        "attributes": ["class*=fillIn", "aria-label=answer"]
      },
      "interaction": {
        "methods": ["type"],
        "sequence": ["focus input", "trusted type or reactSet value", "dispatch input+change", "verify value matches"],
        "elementStrategies": ["fillIn class first, then aria-label answer, exclude search"]
      },
      "completionCheck": {
        "required": true,
        "checks": ["input.value non-empty after normalize", "matches intended answer when known"],
        "incompleteSignals": ["incomplete answer", "enter an answer"]
      },
      "submission": {
        "buttonSelectors": ["button.submit-button", "button[class*=\"submit\"]"],
        "preSubmitVerify": true,
        "maxSubmitAttempts": 2
      },
      "recovery": {
        "onIncomplete": ["re-read inputs", "re-apply value via reactSet", "verify again", "stop if still empty"],
        "maxRecoveryAttempts": 2
      },
      "failureModes": ["React controlled input ignores .value", "wrong input focused"],
      "testResults": [
        {"kind": "unit", "name": "completion-check-empty", "passed": true, "at": "2026-10-22"}
      ],
      "version": "1.0.0",
      "lastValidated": "2026-10-22T13:50:00Z",
      "notes": "Primary validated path. reactSet + trusted type. Completion guard required before submit."
    },
    {
      "id": "multiple-choice",
      "name": "Multiple Choice",
      "aliases": ["mc", "single-select"],
      "subjects": ["math-geometry", "ela-grade-10", "science-chemistry", "social-civics"],
      "trust": "validated",
      "confidence": 0.88,
      "detection": {
        "selectors": [".SelectableTile", ".TileMultipleChoices", "[class*=\"SelectableTile\"]", "[class*=\"TileMultipleChoices\"]", "[class*=\"MULTIPLE_CHOICE\"]"],
        "requireInRoot": true,
        "minMatches": 2,
        "negativeSelectors": [],
        "textHints": []
      },
      "dom": {
        "answerControls": "SelectableTile buttons/tiles",
        "attributes": ["SelectableTile--selected", "aria-pressed", "aria-selected"]
      },
      "interaction": {
        "methods": ["click"],
        "sequence": ["list tiles in root", "match answer text", "trusted click", "wait for selected state"],
        "elementStrategies": ["scoped to question root only — never document-wide"]
      },
      "completionCheck": {
        "required": true,
        "checks": ["at least one tile has SelectableTile--selected or aria-selected=true"],
        "incompleteSignals": ["incomplete answer", "select an answer"]
      },
      "submission": {
        "buttonSelectors": ["button.submit-button"],
        "preSubmitVerify": true,
        "maxSubmitAttempts": 2
      },
      "recovery": {
        "onIncomplete": ["re-match choice", "re-click", "verify selected", "stop if not selected"],
        "maxRecoveryAttempts": 2
      },
      "failureModes": ["chrome buttons mistaken for choices", "selection not applied"],
      "testResults": [
        {"kind": "unit", "name": "isChoiceSelected", "passed": true, "at": "2026-10-22"}
      ],
      "version": "1.0.0",
      "lastValidated": "2026-10-22T13:50:00Z",
      "notes": "Scoped root required. No document-wide choice fallback."
    },
    {
      "id": "multiple-select",
      "name": "Multiple Select",
      "aliases": ["multiselect", "select-all"],
      "subjects": ["math-geometry", "ela-grade-10", "science-chemistry", "social-civics"],
      "trust": "validated",
      "confidence": 0.82,
      "detection": {
        "selectors": [".SelectableTile", "[class*=\"MULTIPLE_SELECT\"]", "[class*=\"TileMultipleChoices\"]"],
        "requireInRoot": true,
        "minMatches": 2,
        "negativeSelectors": [],
        "textHints": ["select all that apply", "select two", "select three", "which two", "more than one"]
      },
      "dom": {
        "answerControls": "multi SelectableTile",
        "attributes": ["SelectableTile--selected"]
      },
      "interaction": {
        "methods": ["click"],
        "sequence": ["match each answer", "click each", "verify each selected independently"],
        "elementStrategies": ["same as MC + multi flag from question text"]
      },
      "completionCheck": {
        "required": true,
        "checks": ["count of selected tiles >= expected answer count"],
        "incompleteSignals": ["incomplete answer", "select all that apply"]
      },
      "submission": {
        "buttonSelectors": ["button.submit-button"],
        "preSubmitVerify": true,
        "maxSubmitAttempts": 2
      },
      "recovery": {
        "onIncomplete": ["re-click missing selections", "verify counts", "stop"],
        "maxRecoveryAttempts": 2
      },
      "failureModes": ["partial selection", "deselect race"],
      "testResults": [],
      "version": "1.0.0",
      "lastValidated": "2026-10-22T13:50:00Z",
      "notes": "Detected via MC tiles + text multi cues; apply path uses multiselect type."
    },
    {
      "id": "dropdown",
      "name": "Dropdown / Inline Choice",
      "aliases": ["inline-choice", "drop-down"],
      "subjects": ["ela-grade-10", "science-chemistry", "social-civics"],
      "trust": "tested",
      "confidence": 0.7,
      "detection": {
        "selectors": [".drop-down-input", "select.drop-down-input", "[class*=\"dropDownInput\"]", "select[class*=\"drop-down\"]"],
        "requireInRoot": true,
        "minMatches": 1,
        "negativeSelectors": ["select[class*=\"search\"]", "select[name*=\"lang\"]"],
        "textHints": []
      },
      "dom": {
        "answerControls": "custom drop-down-input or native select with answer markers",
        "attributes": ["role=listbox", "role=option"]
      },
      "interaction": {
        "methods": ["select", "click"],
        "sequence": ["open trigger", "find option by text", "click option", "verify displayed value"],
        "elementStrategies": ["answer-related class/aria only for native select"]
      },
      "completionCheck": {
        "required": true,
        "checks": ["selected option text non-empty / matches intended"],
        "incompleteSignals": ["incomplete answer", "select an option"]
      },
      "submission": {
        "buttonSelectors": ["button.submit-button"],
        "preSubmitVerify": true,
        "maxSubmitAttempts": 2
      },
      "recovery": {
        "onIncomplete": ["re-open dropdown", "reselect", "stop"],
        "maxRecoveryAttempts": 2
      },
      "failureModes": ["listbox not rendered", "option text mismatch"],
      "testResults": [],
      "version": "1.0.0",
      "lastValidated": null,
      "notes": "Native + custom paths in solver."
    },
    {
      "id": "number-line",
      "name": "Number Line Placement",
      "aliases": ["numberline", "number-line"],
      "subjects": ["math-geometry"],
      "trust": "unknown",
      "confidence": 0.3,
      "detection": {
        "selectors": ["[class*=\"number-line\"]", "[class*=\"numberLine\"]", "[class*=\"NumberLine\"]", "svg[class*=\"number\"]"],
        "requireInRoot": true,
        "minMatches": 1,
        "negativeSelectors": [],
        "textHints": ["number line", "place the point"]
      },
      "dom": {
        "answerControls": "number line SVG/canvas with placeable markers",
        "attributes": ["class*=numberLine", "class*=number-line"]
      },
      "interaction": {
        "methods": ["click"],
        "sequence": ["map value to position", "click", "verify marker"],
        "elementStrategies": ["scale from axis labels"]
      },
      "completionCheck": {
        "required": true,
        "checks": ["marker present on line"],
        "incompleteSignals": ["incomplete answer"]
      },
      "submission": {
        "buttonSelectors": ["button.submit-button"],
        "preSubmitVerify": true,
        "maxSubmitAttempts": 2
      },
      "recovery": {
        "onIncomplete": ["retry placement once", "stop"],
        "maxRecoveryAttempts": 1
      },
      "failureModes": ["scale mapping error"],
      "testResults": [],
      "version": "1.0.0",
      "lastValidated": null,
      "notes": "No dedicated solver handler; often surfaces as graph or unknown."
    },
    {
      "id": "matching-sorting",
      "name": "Matching / Sorting / Classification",
      "aliases": ["matching", "sorting", "classification", "choice-matrix"],
      "subjects": ["science-chemistry", "social-civics", "math-geometry", "ela-grade-10"],
      "trust": "tested",
      "confidence": 0.55,
      "detection": {
        "selectors": [".choiceCell", "[class*=\"choice-matrix\"]", "[class*=\"choiceMatrix\"]", "[class*=\"ChoiceMatrix\"]"],
        "requireInRoot": true,
        "minMatches": 1,
        "negativeSelectors": [],
        "textHints": ["classify", "match", "sort into"]
      },
      "dom": {
        "answerControls": "matrix rows/cells or sort buckets",
        "attributes": ["class*=choiceCell", "class*=matrix"]
      },
      "interaction": {
        "methods": ["click", "drag"],
        "sequence": ["map row→column or item→bucket", "apply", "verify"],
        "elementStrategies": ["row labels + column headers"]
      },
      "completionCheck": {
        "required": true,
        "checks": ["each required row has a selected cell"],
        "incompleteSignals": ["incomplete answer"]
      },
      "submission": {
        "buttonSelectors": ["button.submit-button"],
        "preSubmitVerify": true,
        "maxSubmitAttempts": 2
      },
      "recovery": {
        "onIncomplete": ["fill missing rows", "stop"],
        "maxRecoveryAttempts": 2
      },
      "failureModes": ["column header misread", "row group by y-position drift"],
      "testResults": [],
      "version": "1.0.0",
      "lastValidated": null,
      "notes": "choice-matrix path exists in solver as CHOICE_MATRIX."
    },
    {
      "id": "tables-charts",
      "name": "Tables, Charts, and Data Interaction",
      "aliases": ["table", "chart", "data-table"],
      "subjects": ["science-chemistry", "social-civics", "math-geometry"],
      "trust": "unknown",
      "confidence": 0.25,
      "detection": {
        "selectors": ["table[class*=\"answer\"]", "[class*=\"data-table\"]", "[class*=\"chart-interactive\"]"],
        "requireInRoot": true,
        "minMatches": 1,
        "negativeSelectors": [],
        "textHints": ["complete the table", "from the chart"]
      },
      "dom": {
        "answerControls": "editable cells or selectable chart elements",
        "attributes": ["class*=data-table", "class*=chart"]
      },
      "interaction": {
        "methods": ["type", "click"],
        "sequence": ["identify cells", "enter/select values", "verify"],
        "elementStrategies": ["table cell inputs"]
      },
      "completionCheck": {
        "required": true,
        "checks": ["required cells non-empty"],
        "incompleteSignals": ["incomplete answer"]
      },
      "submission": {
        "buttonSelectors": ["button.submit-button"],
        "preSubmitVerify": true,
        "maxSubmitAttempts": 2
      },
      "recovery": {
        "onIncomplete": ["fill empty required cells", "stop"],
        "maxRecoveryAttempts": 1
      },
      "failureModes": ["ambiguous cell mapping"],
      "testResults": [],
      "version": "1.0.0",
      "lastValidated": null,
      "notes": "Often reduces to fill-in or MC depending on skill."
    },
    {
      "id": "fraction",
      "name": "Fraction Widget",
      "aliases": ["fraction-entry"],
      "subjects": ["math-geometry"],
      "trust": "tested",
      "confidence": 0.75,
      "detection": {
        "selectors": ["[class*=\"fraction\"]", "[class*=\"Fraction\"]"],
        "requireInRoot": true,
        "minMatches": 1,
        "negativeSelectors": [],
        "textHints": []
      },
      "dom": {
        "answerControls": "stacked numerator/denominator fill-ins",
        "attributes": ["class*=fraction"]
      },
      "interaction": {
        "methods": ["type"],
        "sequence": ["parse num/den", "set both inputs", "verify both values"],
        "elementStrategies": ["two visible fillIn inputs stacked"]
      },
      "completionCheck": {
        "required": true,
        "checks": ["both inputs non-empty when fraction expected"],
        "incompleteSignals": ["incomplete answer"]
      },
      "submission": {
        "buttonSelectors": ["button.submit-button"],
        "preSubmitVerify": true,
        "maxSubmitAttempts": 2
      },
      "recovery": {
        "onIncomplete": ["re-set num and den", "stop"],
        "maxRecoveryAttempts": 2
      },
      "failureModes": ["order of inputs reversed", "single field only"],
      "testResults": [],
      "version": "1.0.0",
      "lastValidated": null,
      "notes": "Detected when >=2 fill-ins stacked or fraction parent."
    },
    {
      "id": "unknown",
      "name": "Unknown / Unsupported",
      "aliases": [],
      "subjects": [],
      "trust": "unknown",
      "confidence": 0,
      "detection": {
        "selectors": [],
        "requireInRoot": true,
        "minMatches": 0,
        "negativeSelectors": [],
        "textHints": []
      },
      "dom": {
        "answerControls": "unclassified",
        "attributes": []
      },
      "interaction": {
        "methods": [],
        "sequence": ["do not auto-interact destructively", "log surface", "export for auditor"],
        "elementStrategies": []
      },
      "completionCheck": {
        "required": false,
        "checks": [],
        "incompleteSignals": []
      },
      "submission": {
        "buttonSelectors": [],
        "preSubmitVerify": true,
        "maxSubmitAttempts": 0
      },
      "recovery": {
        "onIncomplete": ["stop"],
        "maxRecoveryAttempts": 0
      },
      "failureModes": ["forced wrong category"],
      "testResults": [],
      "version": "1.0.0",
      "lastValidated": null,
      "notes": "First-class. Prefer UNKNOWN over false classification."
    }
  ]
}
;

  // --- knowledge_store (inline) ---
/**
 * Question Types Knowledge Store
 * Shared by Auditor and Solver via GM storage key + embedded seed.
 * Trust states: unknown | candidate | tested | validated | deprecated
 * Only validated (or tested with explicit opt-in) procedures drive auto interaction.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.CinderQuestionTypes = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'cinder_qt_knowledge_v1';
  const SCHEMA_VERSION = '1.0.0';

  const TRUST_RANK = {
    unknown: 0,
    candidate: 1,
    tested: 2,
    validated: 3,
    deprecated: -1
  };

  // Minimal seed if registry.json not loaded (userscript embeds via CFG or GM)
  const EMBEDDED_SEED = {
    schemaVersion: SCHEMA_VERSION,
    knowledgeVersion: '1.0.0',
    updatedAt: null,
    types: []
  };

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function loadFromGM(gmGet) {
    try {
      const raw = gmGet ? gmGet(STORAGE_KEY, null) : null;
      if (!raw) return null;
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!obj || !Array.isArray(obj.types)) return null;
      return obj;
    } catch (_) {
      return null;
    }
  }

  function saveToGM(store, gmSet) {
    if (!gmSet) return false;
    try {
      store.updatedAt = new Date().toISOString();
      gmSet(STORAGE_KEY, JSON.stringify(store));
      return true;
    } catch (_) {
      return false;
    }
  }

  function createStore(seed, gmGet, gmSet) {
    let data = loadFromGM(gmGet) || clone(seed || EMBEDDED_SEED);
    if (!data.types) data.types = [];

    function byId(id) {
      return data.types.find(t => t.id === id) || null;
    }

    function list(filterTrust) {
      if (!filterTrust) return data.types.slice();
      const min = TRUST_RANK[filterTrust] ?? 0;
      return data.types.filter(t => (TRUST_RANK[t.trust] ?? 0) >= min && t.trust !== 'deprecated');
    }

    function upsert(record) {
      if (!record || !record.id) throw new Error('record.id required');
      const i = data.types.findIndex(t => t.id === record.id);
      const next = { ...record, version: record.version || '1.0.0' };
      if (i >= 0) data.types[i] = { ...data.types[i], ...next };
      else data.types.push(next);
      saveToGM(data, gmSet);
      return byId(record.id);
    }

    function setTrust(id, trust, evidence) {
      const rec = byId(id);
      if (!rec) return null;
      rec.trust = trust;
      if (evidence) {
        rec.testResults = rec.testResults || [];
        rec.testResults.push({ ...evidence, at: new Date().toISOString() });
      }
      if (trust === 'validated') rec.lastValidated = new Date().toISOString();
      saveToGM(data, gmSet);
      return rec;
    }

    function isAutoEligible(id) {
      const rec = byId(id);
      if (!rec) return false;
      return rec.trust === 'validated'; // tested requires explicit opt-in
    }

    function matchDetection(root, qText) {
      // Return best matching type id by selector hits inside root
      if (!root) return 'unknown';
      const text = (qText || '').toLowerCase();
      let best = null;
      let bestScore = 0;
      for (const t of data.types) {
        if (t.id === 'unknown' || t.trust === 'deprecated') continue;
        const det = t.detection || {};
        // negativeSelectors: any hit disqualifies
        let neg = false;
        for (const sel of det.negativeSelectors || []) {
          try { if (root.querySelector(sel)) { neg = true; break; } } catch (_) {}
        }
        if (neg) continue;
        let score = 0;
        let matchCount = 0;
        const sels = det.selectors || [];
        for (const sel of sels) {
          try {
            const nodes = root.querySelectorAll(sel);
            if (nodes && nodes.length) {
              score += 2;
              matchCount += nodes.length;
            }
          } catch (_) {}
        }
        const minM = det.minMatches != null ? det.minMatches : 1;
        if (sels.length && matchCount < minM) continue;
        for (const hint of det.textHints || []) {
          try {
            if (new RegExp(hint, 'i').test(text)) score += 1;
          } catch (_) {}
        }
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }
      if (!best || bestScore < 1) return 'unknown';
      return best.id;
    }

    function getProcedure(id) {
      const rec = byId(id);
      if (!rec) return null;
      return {
        id: rec.id,
        trust: rec.trust,
        eligible: isAutoEligible(id),
        interaction: rec.interaction || {},
        completionCheck: rec.completionCheck || {},
        submission: rec.submission || {},
        recovery: rec.recovery || {},
        confidence: rec.confidence || 0
      };
    }

    function exportJSON() {
      return clone(data);
    }

    function importMerge(incoming) {
      if (!incoming || !Array.isArray(incoming.types)) return false;
      for (const t of incoming.types) {
        if (!t.id) continue;
        const existing = byId(t.id);
        if (!existing) {
          data.types.push(clone(t));
        } else {
          // Prefer higher trust; keep local testResults
          const rankIn = TRUST_RANK[t.trust] ?? 0;
          const rankEx = TRUST_RANK[existing.trust] ?? 0;
          if (rankIn > rankEx) {
            data.types[data.types.findIndex(x => x.id === t.id)] = {
              ...existing,
              ...t,
              testResults: (existing.testResults || []).concat(t.testResults || [])
            };
          }
        }
      }
      saveToGM(data, gmSet);
      return true;
    }

    return {
      STORAGE_KEY,
      SCHEMA_VERSION,
      byId,
      list,
      upsert,
      setTrust,
      isAutoEligible,
      matchDetection,
      getProcedure,
      exportJSON,
      importMerge,
      raw: () => data
    };
  }

  return {
    createStore,
    TRUST_RANK,
    STORAGE_KEY,
    SCHEMA_VERSION
  };
});


  // --- completion (inline) ---
/**
 * Answer completion verification — evidence-based, type-specific.
 * Never treat "click succeeded" as "answer registered".
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.CinderCompletion = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function isChoiceSelected(el) {
    if (!el) return false;
    let cur = el;
    for (let depth = 0; depth < 6 && cur; depth++) {
      const aria = (
        (cur.getAttribute && (cur.getAttribute('aria-pressed') || cur.getAttribute('aria-selected') || cur.getAttribute('aria-checked'))) || ''
      ).toLowerCase();
      if (aria === 'true') return true;
      const cls = String(cur.className || '');
      if (/SelectableTile--selected|TileMultipleChoices--selected|is-selected|isSelected|--chosen|--active|tile--selected|answer--selected|select-word--selected|select-words-chunk--selected|selected|highlighted|is-highlighted|word--selected/i.test(cls)) return true;
      if (cur.getAttribute && (cur.getAttribute('data-selected') === 'true' || cur.getAttribute('data-state') === 'selected')) return true;
      const input = cur.matches && cur.matches('input') ? cur : (cur.querySelector && cur.querySelector('input[type="radio"], input[type="checkbox"]'));
      if (input && input.checked) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function getFillValues(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return [];
    const inputs = [...d.querySelectorAll(
      'input.fillIn, .fillIn input, input[class*="fillIn"], .science-fill-in, ' +
      'input[aria-label="answer"], input[type="text"]:not([type="hidden"]), input[type="number"], textarea, [contenteditable="true"]'
    )].filter(el => el.offsetParent !== null);
    return inputs.map(el => {
      if (el.isContentEditable) return normalize(el.innerText || el.textContent);
      return normalize(el.value);
    });
  }

  function countSelectedTiles(root) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return 0;
    const tiles = [...scope.querySelectorAll('.SelectableTile, [class*="SelectableTile"], .TileMultipleChoices, [class*="TileMultipleChoices"]')];
    return tiles.filter(isChoiceSelected).length;
  }

  /**
   * verifyCompletion(qtype, opts) -> { complete: boolean, evidence: string, details: object }
   * opts: { root, intendedAnswer, minSelected }
   */
  function verifyCompletion(qtype, opts) {
    opts = opts || {};
    const root = opts.root || null;
    const intended = opts.intendedAnswer;
    const details = { qtype, checks: [] };

    if (qtype === 'fill-in' || qtype === 'fraction' || qtype === 'text-entry') {
      const values = getFillValues(root || (typeof document !== 'undefined' ? document : null));
      const nonEmpty = values.filter(v => v.length > 0);
      details.checks.push({ name: 'fill-nonempty', values, nonEmpty: nonEmpty.length });
      if (!nonEmpty.length) {
        return { complete: false, evidence: 'no fill-in value registered', details };
      }
      if (intended != null && intended !== '') {
        const want = normalize(String(intended));
        const hit = nonEmpty.some(v => v === want);
        details.checks.push({ name: 'fill-matches-intended', hit, intended: String(intended), values: nonEmpty });
        if (!hit) {
          return { complete: false, evidence: 'fill value does not match intended', details, mismatch: true };
        }
      }
      return { complete: true, evidence: 'fill-in has registered value', details };
    }

    if (qtype === 'multiple-choice' || qtype === 'multiple-select' || qtype === 'multiselect') {
      const n = countSelectedTiles(root);
      const min = opts.minSelected != null ? opts.minSelected : 1;
      details.checks.push({ name: 'selected-tiles', count: n, min });
      if (n < min) {
        return { complete: false, evidence: `selected tiles ${n} < required ${min}`, details };
      }
      return { complete: true, evidence: `${n} tile(s) selected`, details };
    }

    if (qtype === 'dropdown') {
      const d = root || (typeof document !== 'undefined' ? document : null);
      if (!d) return { complete: false, evidence: 'no document', details };
      const natives = [...d.querySelectorAll('select')].filter(el => el.offsetParent !== null);
      const filledNative = natives.filter(s => s.value && s.selectedIndex >= 0 && s.options[s.selectedIndex] && s.options[s.selectedIndex].text);
      const triggers = [...d.querySelectorAll('.drop-down-input, [class*="dropDownInput"]')].filter(el => el.offsetParent !== null);
      const triggerText = triggers.map(t => normalize(t.innerText || t.getAttribute('aria-label') || ''));
      const anyTrigger = triggerText.some(t => t && !/select|choose|—|-/i.test(t));
      details.checks.push({ name: 'dropdown', filledNative: filledNative.length, triggers: triggerText });
      if (filledNative.length || anyTrigger) {
        return { complete: true, evidence: 'dropdown has selection', details };
      }
      return { complete: false, evidence: 'no dropdown selection registered', details };
    }

    if (qtype === 'text-highlight') {
      const d = root || (typeof document !== 'undefined' ? document : null);
      if (!d) return { complete: false, evidence: 'no document', details };
      const chunks = [...d.querySelectorAll('.select-words-chunk, .select-word, [class*="selectWords"]')];
      const selected = chunks.filter(isChoiceSelected);
      details.checks.push({ name: 'highlight-selected', count: selected.length });
      if (!selected.length) {
        // also check class on chunk
        const clsSel = chunks.filter(c => /selected|active|highlighted/i.test(String(c.className || '')));
        if (!clsSel.length) return { complete: false, evidence: 'no highlight selection', details };
      }
      return { complete: true, evidence: 'highlight selection present', details };
    }

    if (qtype === 'choice-matrix' || qtype === 'matching-sorting') {
      const d = root || (typeof document !== 'undefined' ? document : null);
      if (!d) return { complete: false, evidence: 'no document', details };
      const cells = [...d.querySelectorAll('.choiceCell, [class*="choiceCell"]')];
      const selected = cells.filter(isChoiceSelected);
      details.checks.push({ name: 'matrix-cells', selected: selected.length, total: cells.length });
      if (!selected.length) return { complete: false, evidence: 'no matrix cell selected', details };
      return { complete: true, evidence: `${selected.length} matrix cell(s) selected`, details };
    }

    if (qtype === 'drag-drop') {
      const d = root || (typeof document !== 'undefined' ? document : null);
      if (!d) return { complete: false, evidence: 'no document', details };
      const zones = [...d.querySelectorAll('.dropZone, [class*="dropZone"], [class*="drop-zone"]')];
      // heuristic: zone has child with text or data
      const occupied = zones.filter(z => (z.innerText || '').trim().length > 0 || z.querySelector('[class*="draggable"]'));
      details.checks.push({ name: 'drop-zones', occupied: occupied.length, zones: zones.length });
      if (!occupied.length && zones.length) return { complete: false, evidence: 'no drop zone occupied', details };
      // if no zones found, cannot verify — uncertain
      if (!zones.length) return { complete: false, evidence: 'no drop zones found to verify', details, uncertain: true };
      return { complete: true, evidence: `${occupied.length} zone(s) occupied`, details };
    }

    if (qtype === 'graph' || qtype === 'graph-placement' || qtype === 'number-line' || qtype === 'hot-spot' || qtype === 'equation-editor' || qtype === 'unknown') {
      details.checks.push({ name: 'unsupported-auto-complete', qtype });
      return { complete: false, evidence: `no automated completion check for ${qtype}`, details, unsupported: true };
    }

    // default: require some evidence of interaction
    return { complete: false, evidence: 'unknown type — refuse auto-complete', details, unsupported: true };
  }

  /**
   * State machine helpers for incomplete recovery.
   * States: DETECTED → IDENTIFIED → ANSWERING → VERIFYING → READY_TO_SUBMIT → SUBMITTING → RESULT_CHECK
   *          └──── recovery ────→ IDENTIFIED / ANSWERING (bounded)
   */
  const MAX_SUBMIT_ATTEMPTS = 2;
  const MAX_RECOVERY_ATTEMPTS = 2;

  function createSubmissionGuard() {
    let submitAttempts = 0;
    let recoveryAttempts = 0;
    let state = 'DETECTED';
    const log = [];

    function transition(to, reason) {
      log.push({ from: state, to, reason, t: Date.now() });
      state = to;
    }

    function canSubmit(completion) {
      if (submitAttempts >= MAX_SUBMIT_ATTEMPTS) {
        transition('ERROR', 'max submit attempts');
        return false;
      }
      if (!completion || !completion.complete) {
        transition('VERIFYING', completion ? completion.evidence : 'no completion');
        return false;
      }
      if (completion.unsupported) return false;
      transition('READY_TO_SUBMIT', completion.evidence);
      return true;
    }

    function recordSubmit() {
      submitAttempts++;
      transition('SUBMITTING', 'attempt ' + submitAttempts);
    }

    function onIncomplete() {
      recoveryAttempts++;
      if (recoveryAttempts > MAX_RECOVERY_ATTEMPTS) {
        transition('ERROR', 'max recovery attempts');
        return { recover: false, stop: true };
      }
      transition('ANSWERING', 'incomplete recovery ' + recoveryAttempts);
      return { recover: true, stop: false, attempt: recoveryAttempts };
    }

    function onResultOk() {
      transition('RESULT_CHECK', 'ok');
      submitAttempts = 0;
      recoveryAttempts = 0;
    }

    function reset() {
      submitAttempts = 0;
      recoveryAttempts = 0;
      state = 'DETECTED';
      log.length = 0;
    }

    return {
      get state() { return state; },
      get submitAttempts() { return submitAttempts; },
      get recoveryAttempts() { return recoveryAttempts; },
      get log() { return log.slice(); },
      transition,
      canSubmit,
      recordSubmit,
      onIncomplete,
      onResultOk,
      reset,
      MAX_SUBMIT_ATTEMPTS,
      MAX_RECOVERY_ATTEMPTS
    };
  }

  return {
    verifyCompletion,
    isChoiceSelected,
    getFillValues,
    countSelectedTiles,
    createSubmissionGuard,
    MAX_SUBMIT_ATTEMPTS,
    MAX_RECOVERY_ATTEMPTS,
    normalize
  };
});


  const QT_STORE = (typeof CinderQuestionTypes !== 'undefined' ? CinderQuestionTypes : self.CinderQuestionTypes).createStore(
    QT_REGISTRY_SEED,
    (k, d) => GM_getValue(k, d),
    (k, v) => GM_setValue(k, v)
  );
  // Merge seed on every boot without downgrading trust
  try { QT_STORE.importMerge(QT_REGISTRY_SEED); } catch (_) {}

  const QT_COMP = (typeof CinderCompletion !== 'undefined' ? CinderCompletion : self.CinderCompletion);
  let submissionGuard = QT_COMP.createSubmissionGuard();

  // ─────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────
  let running = false;
  let processing = false;
  let runId = 0;                 // increments on Start/Stop; stale async must exit
  let sessionTerminalHash = '';  // question hash that exhausted recovery — skip until changed
  let missesDoneThisSession = 0;
  let questionsDoneThisSession = 0;
  let lastIncompleteAt = 0;
  let currentQuestionHash = '';
  let lastActivity = Date.now();
  let solveTimer = null;
  let antiIdleTimer = null;

  function isRunActive(id) {
    return running && id === runId;
  }
  let panel = null;
  let logEl = null;

  // ─────────────────────────────────────────────
  // UTILS
  // ─────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
    return h.toString(36);
  }

  function readLiveFlags() {
    const root = panel || document;
    const get = id => root.querySelector('#' + id);
    const autosub = get('c-autosub');
    const delayon = get('c-delayon');
    const useRate = get('c-use-rate');
    const useCount = get('c-use-count');
    const missEl = get('c-miss');
    const missCntEl = get('c-misscount');
    const dbl = get('c-double');
    if (autosub) CFG.autoSubmit = !!autosub.checked;
    if (delayon) CFG.delayEnabled = !!delayon.checked;
    if (dbl) CFG.doubleCheck = !!dbl.checked;
    if (useCount && useCount.checked) CFG.missMode = 'count';
    else if (useRate && useRate.checked) CFG.missMode = 'rate';
    else CFG.missMode = 'off';
    if (missEl) { const v = parseFloat(missEl.value); CFG.intentionalMissRate = isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
    if (missCntEl) { const n = parseInt(missCntEl.value, 10); CFG.missCountTarget = isFinite(n) && n >= 0 ? n : 0; }
  }

  function shouldIntentionalMiss() {
    // intentional miss controlled by missMode (off|rate|count); default off
    return false;
  }

  function log(msg, type = 'info') {
    console.log(`[Cinder IXL] ${msg}`);
    if (!logEl) return;
    const line = document.createElement('div');
    line.style.color = type === 'err' ? '#f66' : type === 'ok' ? '#6f6' : '#ccc';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    while (logEl.children.length > 60) logEl.removeChild(logEl.firstChild);
  }

  function updateStatus(txt) {
    const el = document.getElementById('cinder-status');
    if (el) el.textContent = txt;
  }

  // ─────────────────────────────────────────────
  // QUESTION TYPE DETECTION
  // Uses the auditor's real class fingerprints
  // ─────────────────────────────────────────────
  const QType = {
    MULTIPLE_CHOICE: 'multiple-choice',   // SelectableTile, TileMultipleChoices
    FILL_IN: 'fill-in',                   // .fillIn input, .science-fill-in
    DROPDOWN: 'dropdown',                  // .drop-down-input, [role=listbox]
    TEXT_HIGHLIGHT: 'text-highlight',      // .select-words-chunk, .select-word
    CHOICE_MATRIX: 'choice-matrix',        // .choiceCell, .choice-matrix-cell
    DRAG_DROP: 'drag-drop',               // .dragAndDropContainer, .draggableElement
    FRACTION: 'fraction',                  // stacked fill-in with multiple inputs (numerator/denominator)
    GRAPH: 'graph',                        // .graphingPointerOverlay, canvas graph
    UNKNOWN: 'unknown'
  };

  function detectQuestionType(root) {
    const scope = root || getQuestionRoot() || document;
    const q = (sel) => {
      try {
        const list = [...scope.querySelectorAll(sel)].filter(el => {
          if (!el || el.offsetParent === null) return false;
          // ignore our panel
          if (el.closest && el.closest('#cinder-ixl-panel')) return false;
          return true;
        });
        return list;
      } catch (_) { return []; }
    };
    const has = (sel) => q(sel).length > 0;

    // Evidence-based order: most specific structural types first.
    // Never use document-wide matches that can hit chrome/sidebar.

    // Choice matrix: cells in a matrix/table structure
    if (has('.choiceCell, [class*="choice-matrix"], [class*="choiceMatrix"], [class*="ChoiceMatrix"]'))
      return QType.CHOICE_MATRIX;

    // Drag-drop
    if (has('.dragAndDropContainer, .draggableElement, [class*="dragWrapper"], [class*="drag-drop"], [class*="DragDrop"]'))
      return QType.DRAG_DROP;

    // Graph
    if (has('.graphingPointerOverlay, [class*="graphingPointer"], [class*="GraphingPointer"]'))
      return QType.GRAPH;

    // Text highlight (passage word select)
    if (has('.select-words-chunk, .select-word, [class*="select-words"], [class*="selectWords"], [class*="SelectWords"]'))
      return QType.TEXT_HIGHLIGHT;

    // Dropdown — only IXL answer dropdown markers inside the active root
    if (has('.drop-down-input, [class*="dropDownInput"], select.drop-down-input'))
      return QType.DROPDOWN;
    // native <select>: require answer-related class OR explicit answer aria — not "any 2–30 options"
    const selects = q('select').filter(el => {
      const cls = String(el.className || '');
      const aria = String(el.getAttribute('aria-label') || '');
      const name = String(el.name || el.id || '');
      if (/search|lang|locale|grade|subject|filter|sort/i.test(cls + ' ' + aria + ' ' + name)) return false;
      return /drop-down|dropdown|answer|fill|blank|choice/i.test(cls + ' ' + aria + ' ' + name);
    });
    if (selects.length) return QType.DROPDOWN;

    // Multiple choice / multiselect tiles
    if (has('.SelectableTile, .TileMultipleChoices, [class*="SelectableTile"], [class*="TileMultipleChoices"], [class*="MULTIPLE_CHOICE"], [class*="MULTIPLE_SELECT"]'))
      return QType.MULTIPLE_CHOICE;

    // Fill-in / fraction
    const fillIns = q(
      'input.fillIn, .fillIn input, input[class*="fillIn"], .science-fill-in, ' +
      'input[aria-label="answer"], input[type="text"]:not([type="hidden"]), input[type="number"], textarea'
    ).filter(el => {
      // exclude search boxes / login-looking fields
      const name = (el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '');
      if (/search|login|password|email|user/i.test(name)) return false;
      return true;
    });
    if (fillIns.length >= 2) {
      const parent = fillIns[0].closest('[class*="fraction"], [class*="Fraction"], [class*="stacked"]');
      if (parent || fillIns.length === 2) return QType.FRACTION;
    }
    if (fillIns.length >= 1) return QType.FILL_IN;

    // contenteditable answer area
    if (q('[contenteditable="true"]').length) return QType.FILL_IN;

    // yes/no styled buttons without SelectableTile class
    const yn = q('button, [role="button"]').filter(el => /^(yes|no|true|false)$/i.test((el.innerText || el.getAttribute('aria-label') || '').trim()));
    if (yn.length >= 2) return QType.MULTIPLE_CHOICE;

    return QType.UNKNOWN;
  }

  // ─────────────────────────────────────────────
  // QUESTION ROOT + TEXT EXTRACTION
  // ─────────────────────────────────────────────
  function getQuestionRoot() {
    // Prefer the active item, not the entire practice page shell.
    // #practice-page-container is deliberately later: it is the SPA shell and is too broad for classification.
    const priority = [
      '.practice-item',
      '[data-testid="question"]',
      '.question-component',
      '.practice-question',
      '.skill-question',
      '.question-container',
      '[class*="QuestionComponent"]',
      '[class*="practice-item"]'
    ];
    for (const sel of priority) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null && (el.innerText || '').trim().length > 15) return el;
    }
    // Within the practice page shell, pick the largest interactive block that is not the whole page
    const shell = document.querySelector('#practice-page-container, main#practice-page-container');
    const searchRoot = shell || document.querySelector('main') || document.body;
    let best = null, bestLen = 0;
    const kids = searchRoot ? searchRoot.querySelectorAll('section, article, div[class], form') : [];
    kids.forEach(el => {
      if (el === searchRoot) return;
      if (el.closest && el.closest('#cinder-ixl-panel')) return;
      if (el.offsetParent === null) return;
      const t = (el.innerText || '').trim();
      // avoid swallowing the entire page: require content but not page-length chrome
      if (t.length > bestLen && t.length >= 20 && t.length < 2500 && !el.querySelector('nav')) {
        // prefer nodes that contain answer UI
        const hasAnswerUi = el.querySelector(
          '.SelectableTile, .TileMultipleChoices, input.fillIn, .fillIn, .drop-down-input, ' +
          '.choiceCell, .select-words-chunk, .draggableElement, input[aria-label="answer"]'
        );
        const score = t.length + (hasAnswerUi ? 5000 : 0);
        if (score > bestLen + (best && best.querySelector ? 0 : 0)) {
          // track by score via bestLen store
        }
        if (score > bestLen) { best = el; bestLen = score; }
      }
    });
    if (best) return best;
    // last resort: shell itself (too broad — callers must tolerate UNKNOWN)
    if (shell && (shell.innerText || '').trim().length > 15) return shell;
    return null;
  }

  function extractQuestionText() {
    const root = getQuestionRoot();
    if (!root) return null;
    const clone = root.cloneNode(true);
    // strip non-question noise
    clone.querySelectorAll(
      'script, style, noscript, button.submit-button, .scratchpad-button, ' +
      '.undo-button, .redo-button, .clear-button, .audio, [class*="audio"], ' +
      '[class*="confetti"], .timer, .score, #cinder-ixl-panel'
    ).forEach(n => n.remove());
    let text = (clone.innerText || '').replace(/\s+/g, ' ').trim();
    // grab alt text from math images
    root.querySelectorAll('img[alt]').forEach(img => {
      if (img.alt && img.alt.length < 200) text += ' [img: ' + img.alt + ']';
    });
    return text.slice(0, 5000) || null;
  }

  // ─────────────────────────────────────────────
  // CHOICE / INPUT FINDERS per question type
  // ─────────────────────────────────────────────

  function getMultipleChoices(root) {
    const scope = root || getQuestionRoot() || document;
    const seen = new Set();
    const choices = [];
    const add = el => {
      if (!el || el.offsetParent === null) return;
      if (el.closest && el.closest('#cinder-ixl-panel')) return;
      let t = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      t = t.replace(/^Option[,:\s]+/i, '').trim();
      if (!t || t.length > 400 || seen.has(t.toLowerCase())) return;
      if (/^(submit|check|continue|next|skip|hint|audio|example|undo|redo|clear|got it)$/i.test(t)) return;
      seen.add(t.toLowerCase());
      choices.push({ el, text: t });
    };

    const selectors = [
      '.SelectableTile',
      '[class*="SelectableTile"]',
      '.TileMultipleChoices',
      '[class*="TileMultipleChoices"]',
      '[class*="MULTIPLE_CHOICE"] [class*="tile"], [class*="MULTIPLE_SELECT"] [class*="tile"]',
      '.answer-choice',
      '[data-testid="answer-choice"]',
      '[class*="answer-tile"]',
      '[class*="AnswerTile"]',
      'li[class*="option"]',
      'button[aria-label="yes"], button[aria-label="no"]',
      '[class*="yes-no"] button, [class*="YesNo"] button'
    ];
    for (const sel of selectors) {
      try { scope.querySelectorAll(sel).forEach(add); } catch (_) {}
    }
    // Do NOT broaden to document-wide extraction — that pulls unrelated chrome.
    // If the active root has fewer than two clear choices, return what we have (possibly empty)
    // and let the caller treat uncertainty explicitly.
    if (choices.length < 2) {
      log(`MC choices uncertain (${choices.length}) inside active root — not scanning whole page`, 'err');
    } else {
      log(`MC choices (${choices.length}): ` + choices.map(c => `"${c.text}"`).join(', '));
    }
    return choices;
  }

  function isInsideSolverPanel(el) {
    return !!(el && el.closest && el.closest('#cinder-ixl-panel'));
  }

  function isPlausibleAnswerControl(el) {
    if (!el || isInsideSolverPanel(el)) return false;
    if (el.offsetParent === null) return false;
    const id = (el.id || '').toLowerCase();
    const name = (el.getAttribute && (el.getAttribute('name') || '') || '').toLowerCase();
    const cls = String(el.className || '');
    // never touch solver config / chrome
    if (/^c-|^cinder/i.test(id) || id.startsWith('c-')) return false;
    if (/api|key|password|token/i.test(name) || /api|key|password/i.test(id)) return false;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'password' || type === 'hidden' || type === 'checkbox' || type === 'radio' || type === 'button' || type === 'submit') return false;
    // prefer IXL answer markers
    if (/fillIn|fill-in|science-fill|answer/i.test(cls)) return true;
    if ((el.getAttribute('aria-label') || '').toLowerCase().includes('answer')) return true;
    // generic text/number only if inside question root (caller scopes)
    if (type === 'text' || type === 'number' || el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
    return false;
  }

  function getFillInInputs(root) {
    const scope = root || getQuestionRoot() || document;
    const sel =
      'input.fillIn, .fillIn input, input[class*="fillIn"], .science-fill-in, ' +
      'input[aria-label="answer"], input[type="text"]:not([type="hidden"]), ' +
      'input[type="number"], textarea, [contenteditable="true"]';
    let inputs = [...scope.querySelectorAll(sel)].filter(isPlausibleAnswerControl);
    // if scoped root found nothing, try document but still exclude panel
    if (!inputs.length && scope !== document) {
      inputs = [...document.querySelectorAll(sel)].filter(isPlausibleAnswerControl);
    }
    // prefer IXL-marked fill-ins over generic text boxes
    const marked = inputs.filter(el => /fillIn|fill-in|science-fill|answer/i.test(String(el.className || '') + (el.getAttribute('aria-label') || '')));
    if (marked.length) return marked;
    return inputs;
  }

  function getDropdowns(root) {
    const scope = root || getQuestionRoot() || document;
    const triggers = [...scope.querySelectorAll(
      '.drop-down-input, select.drop-down-input, [class*="dropDownInput"]'
    )].filter(el => el.offsetParent !== null && !isInsideSolverPanel(el));
    const nativeSelects = [...scope.querySelectorAll('select')].filter(el =>
      el.offsetParent !== null && !isInsideSolverPanel(el) && /drop-down|dropdown|answer|fill|blank|choice/i.test(String(el.className || '') + (el.getAttribute('aria-label') || ''))
    );
    return { triggers, nativeSelects };
  }

  function getDropdownOptions(triggerEl) {
    // after clicking trigger, IXL renders a listbox — find its options
    const listbox = document.querySelector('[role="listbox"], .drop-down-list, [class*="dropDownList"]');
    if (!listbox) return [];
    return [...listbox.querySelectorAll('[role="option"], li, .drop-down-option, [class*="dropDownOption"]')]
      .filter(el => el.offsetParent !== null)
      .map(el => ({ el, text: (el.innerText || el.getAttribute('aria-label') || '').trim() }))
      .filter(o => o.text);
  }

  function getTextHighlightChunks(root) {
    const scope = root || getQuestionRoot() || document;
    return [...scope.querySelectorAll(
      '.select-words-chunk, .select-word, [class*="selectWordsChunk"], [class*="SelectWordsChunk"]'
    )].filter(el => el.offsetParent !== null && !isInsideSolverPanel(el))
      .map(el => ({ el, text: (el.innerText || '').trim() }))
      .filter(c => c.text);
  }

  function getChoiceMatrixRows() {
    // Each row = a statement + set of choiceCells (A/B/True/False/Yes/No)
    const rows = [];
    const rowEls = document.querySelectorAll(
      '.choice-matrix-row, [class*="choiceMatrixRow"], [class*="ChoiceMatrixRow"],' +
      ' tr[class*="matrix"], [class*="matrix-row"]'
    );
    if (rowEls.length) {
      rowEls.forEach(row => {
        const label = (row.querySelector('[class*="statement"], td:first-child, [class*="label"]')?.innerText || '').trim();
        const cells = [...row.querySelectorAll('.choiceCell, [class*="choiceCell"], td:not(:first-child) [role="radio"], td:not(:first-child) input')]
          .filter(el => el.offsetParent !== null)
          .map(el => {
            // cell header from column: walk up to table to find header
            const colIdx = [...(el.closest('tr')?.children || [])].indexOf(el.closest('td'));
            const header = document.querySelector(`table thead th:nth-child(${colIdx + 1}), [class*="matrix-header"]:nth-child(${colIdx + 1})`);
            return { el, text: (header?.innerText || el.getAttribute('aria-label') || String(colIdx)).trim() };
          });
        if (label && cells.length) rows.push({ label, cells });
      });
    }
    // fallback: if no row elements, find all cells and group by y-position
    if (!rows.length) {
      const cells = [...document.querySelectorAll('.choiceCell, [class*="choiceCell"], [class*="choice-matrix"]')]
        .filter(el => el.offsetParent !== null);
      if (cells.length) {
        // Group by approximate row (y within 20px)
        const groups = new Map();
        cells.forEach(cell => {
          const r = cell.getBoundingClientRect();
          const rowKey = Math.round(r.top / 20) * 20;
          if (!groups.has(rowKey)) groups.set(rowKey, []);
          groups.get(rowKey).push({ el: cell, text: (cell.innerText || cell.getAttribute('aria-label') || '').trim() });
        });
        groups.forEach((grpCells, _key) => {
          rows.push({ label: '', cells: grpCells });
        });
      }
    }
    return rows;
  }

  function inQuestion(el, root) {
    if (!el) return false;
    if (isInsideSolverPanel(el)) return false;
    if (root && root.contains && !root.contains(el)) return false;
    return el.offsetParent !== null;
  }

  function getDraggables(root) {
    const scope = root || getQuestionRoot() || document;
    return [...scope.querySelectorAll(
      '.draggableElement, [class*="draggableElement"], [class*="DraggableElement"],' +
      ' [draggable="true"], [class*="drag-item"], [class*="dragItem"]'
    )].filter(el => inQuestion(el, scope === document ? null : scope))
      .map(el => ({
        el,
        text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('data-label') || '').trim()
      }))
      .filter(d => d.text);
  }

  function zoneLabel(el) {
    const aria = el.getAttribute('aria-label') || el.getAttribute('data-label') || '';
    if (aria.trim()) return aria.trim();
    // heading sibling / previous label — not the dropped item text
    const heading = el.querySelector('[class*="label"], [class*="header"], [class*="title"], legend, h1, h2, h3, h4');
    if (heading && (heading.innerText || '').trim()) return heading.innerText.trim();
    const prev = el.previousElementSibling;
    if (prev && (prev.innerText || '').trim().length < 80) return prev.innerText.trim();
    return (el.getAttribute('data-category') || '').trim();
  }

  function getDropZones(root) {
    const scope = root || getQuestionRoot() || document;
    return [...scope.querySelectorAll(
      '.dropZone, [class*="dropZone"], [class*="DropZone"], .drop-zone, [class*="drop-target"],' +
      ' [class*="dragTarget"], [data-dropzone], [aria-dropeffect]'
    )].filter(el => inQuestion(el, scope === document ? null : scope))
      .map(el => ({ el, text: zoneLabel(el) }))
      .filter(z => z.text);
  }

  function matchDragControl(label, controls) {
    const n = normStr(label);
    if (!n || !controls.length) return null;
    let hit = controls.find(c => normStr(c.text) === n);
    if (hit) return hit;
    hit = controls.find(c => {
      const ct = normStr(c.text);
      if (!ct) return false;
      const short = n.length < ct.length ? n : ct;
      const long = n.length < ct.length ? ct : n;
      return short.length >= 3 && long.includes(short) && short.length / long.length >= 0.35;
    });
    if (hit) return hit;
    let best = null, bestScore = 0;
    const tokens = n.split(' ').filter(w => w.length > 2);
    for (const c of controls) {
      const ct = normStr(c.text);
      if (!tokens.length) continue;
      const hitN = tokens.filter(t => ct.includes(t)).length;
      const score = hitN / tokens.length;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best && bestScore >= 0.6 ? best : null;
  }

  function mapDragAnswer(itemMap, items, zones) {
    const placements = [];
    const failures = [];
    for (const [itemText, zoneText] of Object.entries(itemMap)) {
      const item = matchDragControl(itemText, items);
      if (!item) { failures.push({ code: 'TARGET_NOT_FOUND', role: 'item', label: itemText }); continue; }
      const zn = normStr(zoneText);
      let zone = zones.find(z => {
        const zt = normStr(z.text);
        if (!zt) return false;
        if (zt === zn) return true;
        if (zt.length >= 3 && zn.includes(zt)) return true;
        if (zn.length >= 3 && zt.includes(zn) && zn.length / Math.max(zt.length, 1) >= 0.4) return true;
        return false;
      }) || matchDragControl(zoneText, zones);
      if (!zone) { failures.push({ code: 'TARGET_NOT_FOUND', role: 'zone', label: zoneText }); continue; }
      placements.push({ item, zone });
    }
    return { placements, failures };
  }

  function zoneHoldsItem(zoneEl, itemText) {
    const t = normStr(zoneEl.innerText || '');
    const want = normStr(itemText);
    if (!want) return false;
    return t.includes(want);
  }

  function getSubmitButton() {
    // Score submit candidates, never return an answer tile
    const candidates = [...document.querySelectorAll(
      'button.submit-button, button[class*="submit"], button[data-testid="submit"],' +
      ' button[aria-label*="Submit"], button[aria-label*="Check"], ' +
      ' button[class*="Submit"], input[type="submit"]'
    )].filter(el => {
      if (!el || el.offsetParent === null) return false;
      const r = el.getBoundingClientRect();
      if (!(r.width > 10 && r.height > 10)) return false;
      const cls = (el.className && String(el.className)) || '';
      // never match tiles or choice buttons
      if (/SelectableTile|TileMultiple|answer-choice|choiceCell/i.test(cls)) return false;
      const text = (el.innerText || el.getAttribute('aria-label') || el.value || '').trim();
      if (/^(yes|no|true|false)$/i.test(text)) return false;
      return true;
    });

    if (candidates.length) {
      // prefer button.submit-button (IXL's real submit class)
      const real = candidates.find(b => /submit-button|submit$/i.test(b.className || ''));
      return real || candidates[0];
    }

    // generic scored search
    const buttons = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')];
    let best = null, bestScore = 0;
    for (const b of buttons) {
      const t = ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.value || '')).trim();
      const r = b.getBoundingClientRect();
      const cls = (b.className && String(b.className)) || '';
      if (/SelectableTile|TileMultiple|answer-choice|choiceCell/i.test(cls)) continue;
      if (/^(yes|no|true|false)$/i.test(t)) continue;
      const visible = b.offsetParent !== null && r.width > 10 && r.height > 10 && r.bottom > 0 && r.top < window.innerHeight;
      let score = 0;
      if (/^submit$/i.test(t)) score = 100;
      else if (/^submit answer$/i.test(t)) score = 95;
      else if (/submit/i.test(t)) score = 80;
      else if (/check answer/i.test(t)) score = 70;
      else if (/^check$/i.test(t)) score = 65;
      else if (/continue|done/i.test(t)) score = 30;
      if (!visible) score = 0;
      if (score > bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  // ─────────────────────────────────────────────
  // CLICK / TYPE INFRASTRUCTURE
  // ─────────────────────────────────────────────
  function firePointerEvent(type, target, x, y) {
    const isDown = /down/i.test(type);
    const opts = {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: isDown ? 1 : 0
    };
    try { target.dispatchEvent(new PointerEvent(type, opts)); } catch (_) {}
    try {
      target.dispatchEvent(new MouseEvent(type.replace('pointer', 'mouse'), {
        bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: opts.buttons
      }));
    } catch (_) {}
  }

  // react-aware value setter — single write, replace (never append)
  function reactSet(input, value) {
    if (!input) return;
    const v = String(value);
    const proto = input.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(input, v);
    else input.value = v;
    try {
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: v, inputType: 'insertText' }));
    } catch (_) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function readControlValue(el) {
    if (!el) return '';
    if (el.isContentEditable) return String(el.innerText || el.textContent || '');
    return String(el.value != null ? el.value : '');
  }

  /** Exact match after light normalize (trim only). Keeps decimals/signs. */
  function valuesMatchExact(observed, intended) {
    const a = String(observed ?? '').trim();
    const b = String(intended ?? '').trim();
    return a === b;
  }


  // Extension bridge
  let extReady = false;
  let extReqId = 0;
  const extPending = new Map();

  window.addEventListener('message', ev => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'CINDER_CLICK_EXT') return;
    if (d.type === 'READY') { extReady = true; log('Trusted Click extension ready', 'ok'); return; }
    if (d.requestId != null && extPending.has(d.requestId)) {
      const { resolve } = extPending.get(d.requestId);
      extPending.delete(d.requestId);
      resolve(d.response || { ok: false });
    }
  });

  document.addEventListener('cinder-click-response', ev => {
    const d = ev.detail;
    if (!d || d.requestId == null || !extPending.has(d.requestId)) return;
    const { resolve } = extPending.get(d.requestId);
    extPending.delete(d.requestId);
    resolve(d.response || { ok: false });
  });

  function callExt(payload, timeoutMs = 5000) {
    return new Promise(resolve => {
      const id = ++extReqId;
      let settled = false;
      const finish = r => { if (settled) return; settled = true; extPending.delete(id); resolve(r); };
      extPending.set(id, { resolve: finish });
      const msg = { source: 'CINDER_SOLVER', requestId: id, ...payload };
      window.postMessage(msg, '*');
      try { document.dispatchEvent(new CustomEvent('cinder-click-request', { detail: msg })); } catch (_) {}
      setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs);
    });
  }

  function nativeFallbackClick(target, x, y) {
    try {
      const opts = { bubbles: true, cancelable: true, view: window, clientX: x || 0, clientY: y || 0, button: 0 };
      target.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse' }));
      target.dispatchEvent(new MouseEvent('mousedown', opts));
      target.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse' }));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
      target.dispatchEvent(new MouseEvent('click', opts));
      const radio = target.querySelector && target.querySelector('input[type="radio"], input[type="checkbox"]');
      if (radio && !radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event('input', { bubbles: true }));
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    } catch (_) { try { target.click(); return true; } catch (__) { return false; } }
  }

  // resolve a child span/text to the nearest clickable ancestor
  function resolveClickTarget(el) {
    if (!el) return el;
    let cur = el;
    for (let i = 0; i < 8 && cur; i++) {
      const tag = (cur.tagName || '').toLowerCase();
      const role = cur.getAttribute?.('role') || '';
      const cls = String(cur.className || '');
      const r = cur.getBoundingClientRect?.() || {};
      const sized = r.width >= 12 && r.height >= 12;
      if (sized && (
        tag === 'button' || tag === 'a' || tag === 'label' ||
        role === 'button' || role === 'option' || role === 'radio' || role === 'checkbox' ||
        /SelectableTile|TileMultiple|answer-choice|choiceCell|select-words-chunk|drop-down-input/i.test(cls) ||
        cur.onclick || cur.tabIndex >= 0
      )) return cur;
      cur = cur.parentElement;
    }
    // absolute fallback: nearest sized ancestor
    cur = el;
    for (let i = 0; i < 8 && cur; i++) {
      const r = cur.getBoundingClientRect?.() || {};
      if (r.width >= 12 && r.height >= 12) return cur;
      cur = cur.parentElement;
    }
    return el;
  }

  async function trustedClickEl(el) {
    if (!el) return false;
    let target = resolveClickTarget(el);
    try { target.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) {}
    await sleep(rand(80, 180));
    target = resolveClickTarget(el); // re-resolve after scroll shift

    let rect = target.getBoundingClientRect();
    if (!(rect.width >= 8 && rect.height >= 8)) {
      // walk parents for valid size
      let cur = el;
      for (let i = 0; i < 10 && cur; i++) {
        const r = cur.getBoundingClientRect();
        if (r.width >= 8 && r.height >= 8) { target = cur; rect = r; break; }
        cur = cur.parentElement;
      }
    }
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    if (!(rect.width >= 8 && rect.height >= 8) || x < 1 || y < 1 || x > window.innerWidth || y > window.innerHeight) {
      log(`Bad click target @ ${Math.round(x)},${Math.round(y)} size ${Math.round(rect.width)}x${Math.round(rect.height)}`, 'err');
      return false;
    }

    // try extension first
    const ping = await callExt({ type: 'PING' }, 2000);
    if ((ping && ping.ok) || extReady || window.__CINDER_CLICK_EXT__) {
      const res = await callExt({ type: 'TRUSTED_CLICK', x, y }, 6000);
      if (res && res.ok) { log(`Trusted click OK @ ${Math.round(x)},${Math.round(y)}`, 'ok'); return true; }
      log(`Trusted click failed: ${res?.error || '?'} — native fallback`, 'err');
    }

    const ok = nativeFallbackClick(target, x, y);
    if (ok) log(`Native click @ ${Math.round(x)},${Math.round(y)}`, 'ok');
    return ok;
  }

  /**
   * Single-writer field entry.
   * Strategy: (1) clear via reactSet('') (2) reactSet(intended) once
   * Fallback: if value mismatch, select-all + TRUSTED_TYPE once (extension keystrokes APPEND if field not cleared).
   * Never reactSet(full) then TRUSTED_TYPE(full) — that produced 10.15151015.
   */
  async function writeFieldValue(targetEl, text, opts) {
    opts = opts || {};
    const intended = String(text);
    if (!targetEl || isInsideSolverPanel(targetEl)) {
      log('writeFieldValue: refused — invalid target', 'err');
      return { ok: false, method: 'none', observed: '', intended };
    }
    try { targetEl.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) {}
    try { targetEl.focus(); } catch (_) {}
    await sleep(30);

    // --- primary: programmatic replace ---
    if (targetEl.isContentEditable) {
      targetEl.textContent = '';
      targetEl.textContent = intended;
      targetEl.dispatchEvent(new Event('input', { bubbles: true }));
      targetEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      reactSet(targetEl, '');
      reactSet(targetEl, intended);
    }
    await sleep(40);
    let observed = readControlValue(targetEl);
    if (valuesMatchExact(observed, intended)) {
      log(`write ok [reactSet] intended="${intended}" observed="${observed}"`, 'ok');
      return { ok: true, method: 'reactSet', observed, intended };
    }

    // --- fallback: clear then extension keystrokes (replace, not append) ---
    const ping = await callExt({ type: 'PING' }, 1500);
    if (ping && ping.ok) {
      try { targetEl.focus(); } catch (_) {}
      // select all so keystrokes replace
      try {
        if (targetEl.setSelectionRange && typeof targetEl.value === 'string') {
          targetEl.setSelectionRange(0, targetEl.value.length);
        } else if (targetEl.select) targetEl.select();
      } catch (_) {}
      reactSet(targetEl, ''); // clear first — TRUSTED_TYPE only inserts chars
      await sleep(20);
      try { targetEl.focus(); } catch (_) {}
      const res = await callExt({ type: 'TRUSTED_TYPE', text: intended });
      await sleep(50);
      observed = readControlValue(targetEl);
      if (res && res.ok && valuesMatchExact(observed, intended)) {
        log(`write ok [trustedType] intended="${intended}" observed="${observed}"`, 'ok');
        return { ok: true, method: 'trustedType', observed, intended };
      }
      log(`write mismatch after trustedType intended="${intended}" observed="${observed}"`, 'err');
    } else {
      log(`write mismatch after reactSet intended="${intended}" observed="${observed}"`, 'err');
    }
    return { ok: false, method: 'failed', observed, intended };
  }

  // Back-compat name: single write path only
  async function trustedTypeText(text, targetEl) {
    const r = await writeFieldValue(targetEl, text);
    return !!r.ok;
  }


  // ─────────────────────────────────────────────
  // SELECTION STATE DETECTION
  // ─────────────────────────────────────────────
  function isChoiceSelected(el) {
    if (!el) return false;
    let cur = resolveClickTarget(el);
    for (let depth = 0; depth < 6 && cur; depth++) {
      const aria = (
        cur.getAttribute?.('aria-pressed') ||
        cur.getAttribute?.('aria-selected') ||
        cur.getAttribute?.('aria-checked') || ''
      ).toLowerCase();
      if (aria === 'true') return true;
      const cls = String(cur.className || '');
      // IXL's actual selected class: SelectableTile--selected
      if (/SelectableTile--selected|TileMultipleChoices--selected|is-selected|isSelected|--chosen|--active|tile--selected|answer--selected|select-word--selected|select-words-chunk--selected|selected|highlighted|is-highlighted|word--selected/i.test(cls)) return true;
      if (cur.getAttribute?.('data-selected') === 'true' || cur.getAttribute?.('data-state') === 'selected') return true;
      const input = cur.matches?.('input') ? cur : cur.querySelector?.('input[type="radio"], input[type="checkbox"]');
      if (input?.checked) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  async function waitForSelected(el, timeoutMs = 2500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (isChoiceSelected(el)) return true;
      await sleep(80);
    }
    return isChoiceSelected(el);
  }

  // ─────────────────────────────────────────────
  // PAGE STATE HELPERS
  // ─────────────────────────────────────────────
  function isTechDifficultyPage() {
    const t = document.body?.innerText || '';
    return /Technical difficulties/i.test(t) && /practice questions from loading/i.test(t);
  }

  function pageLooksLikeExplanation() {
    const t = document.body?.innerText || '';
    return /got it/i.test(t) && (/correct answer|explanation|not quite|keep going|the correct/i.test(t) || /smartscore/i.test(t));
  }

  function pageLooksLikeIncomplete() {
    const t = document.body?.innerText || '';
    return /incomplete answer/i.test(t) || /select an answer|enter an answer|please (select|choose|enter)/i.test(t);
  }

  function getDismissButton() {
    let best = null, bestScore = 0;
    for (const b of document.querySelectorAll('button, [role="button"], a, div[role="button"]')) {
      const t = ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim();
      if (!t || t.length > 48) continue;
      const r = b.getBoundingClientRect();
      if (!(r.width > 8 && r.height > 8) || r.bottom < 0 || r.top > window.innerHeight) continue;
      let score = 0;
      if (/^got it!?$/i.test(t)) score = 100;
      else if (/got it/i.test(t)) score = 80;
      else if (/^next question$/i.test(t)) score = 70;
      else if (/^continue$/i.test(t)) score = 60;
      else if (/^try again$/i.test(t)) score = 40;
      if (score > bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  async function dismissExplanationIfPresent() {
    if (!pageLooksLikeExplanation() && !getDismissButton()) return false;
    const btn = getDismissButton();
    if (!btn) return false;
    log(`Dismiss: "${(btn.innerText || '').trim()}"`);
    let ok = await trustedClickEl(btn);
    if (!ok) { try { btn.click(); ok = true; } catch (_) {} }
    if (ok) { log('Dismissed explanation', 'ok'); currentQuestionHash = ''; await sleep(800); return true; }
    return false;
  }

  async function handleIncompleteIfPresent() {
    if (!pageLooksLikeIncomplete()) return false;
    if (Date.now() - lastIncompleteAt < 5000) return false;
    lastIncompleteAt = Date.now();
    log('Incomplete answer screen', 'err');
    const rec = submissionGuard.onIncomplete();
    log(`Incomplete recovery attempt=${submissionGuard.recoveryAttempts} stop=${!!rec.stop} state=${submissionGuard.state}`, 'err');
    if (rec.stop) {
      log('Max incomplete recoveries — terminal for this question hash', 'err');
      updateStatus('Incomplete — recovery exhausted (will not auto-retry this Q)');
      sessionTerminalHash = currentQuestionHash || sessionTerminalHash;
      currentQuestionHash = '';
      // still try Go back so user can re-answer manually
    }
    // find Go back button
    let best = null, bScore = 0;
    for (const b of document.querySelectorAll('button, [role="button"], a')) {
      const t = ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')).trim();
      const r = b.getBoundingClientRect();
      if (!(r.width > 8 && r.height > 8)) continue;
      let s = 0;
      if (/^go back$/i.test(t)) s = 100;
      else if (/go back/i.test(t)) s = 80;
      else if (/^back$/i.test(t)) s = 50;
      if (s > bScore) { bScore = s; best = b; }
    }
    if (best) {
      let ok = await trustedClickEl(best);
      if (!ok) { try { best.click(); } catch (_) {} }
      await sleep(1500);
      for (let i = 0; i < 8 && pageLooksLikeIncomplete(); i++) await sleep(500);
      currentQuestionHash = '';
      if (rec.stop) {
        // prevent immediate re-solve loop
        processing = false;
        return true;
      }
      return true;
    }
    log('Go back button not found', 'err');
    return false;
  }

  async function recoverFromTechDifficulty() {
    log('Tech-difficulty — recovering…', 'err');
    updateStatus('Recovering from IXL error…');
    running = false; processing = false;
    if (solveTimer) { clearInterval(solveTimer); solveTimer = null; }
    if (antiIdleTimer) { clearInterval(antiIdleTimer); antiIdleTimer = null; }
    const toggle = document.getElementById('c-toggle');
    if (toggle) { toggle.textContent = 'Start'; toggle.classList.remove('stop'); toggle.classList.add('go'); }
    const tryBtn = [...document.querySelectorAll('button, a, [role="button"]')]
      .find(b => /try again/i.test((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')));
    if (tryBtn) { await trustedClickEl(tryBtn); await sleep(3000); }
    if (isTechDifficultyPage()) {
      const url = location.href.split('?')[0].split('#')[0];
      location.href = url + (url.includes('?') ? '&' : '?') + '_r=' + Date.now();
      return;
    }
    log('Recovered — press Start', 'ok');
    updateStatus('Recovered — press Start');
  }

  // ─────────────────────────────────────────────
  // LOCAL DB
  // ─────────────────────────────────────────────
  const LOCAL_DB_KEY = 'cinder_ixl_local_qa_db';
  const LOCAL_DB_META_KEY = 'cinder_ixl_local_qa_meta';

  function loadLocalDb() {
    try { const r = GM_getValue(LOCAL_DB_KEY, '[]'); return JSON.parse(typeof r === 'string' ? r : '[]') || []; } catch (_) { return []; }
  }
  function saveLocalDb(entries) {
    try {
      GM_setValue(LOCAL_DB_KEY, JSON.stringify(entries.slice(0, 5000)));
      GM_setValue(LOCAL_DB_META_KEY, { count: Math.min(entries.length, 5000), updated: Date.now() });
    } catch (_) {}
  }
  function normalizeForMatch(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ')
      .replace(/[""\"']/g, '').replace(/[–—−]/g, '-')
      .replace(/[^a-z0-9\s\-\.=<>\/+*()\,%]/g, '').trim();
  }
  function simScore(a, b) {
    const ta = new Set(normalizeForMatch(a).split(/\s+/).filter(Boolean));
    const tb = new Set(normalizeForMatch(b).split(/\s+/).filter(Boolean));
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    const union = ta.size + tb.size - inter;
    return union ? inter / union : 0;
  }
  function searchLocalDb(qText) {
    const db = loadLocalDb();
    if (!db.length) return null;
    const qn = normalizeForMatch(qText);
    if (qn.length < 8) return null;
    let best = null;
    for (let i = 0; i < Math.min(db.length, 2000); i++) {
      const e = db[i];
      if (!e?.q || !e?.a) continue;
      const score = simScore(qn, e.q);
      if (!best || score > best.score) best = { answer: String(e.a).trim(), confidence: Math.min(0.99, 0.7 + score * 0.29), type: e.type || 'text', source: 'local_db', score };
      if (score >= 0.995) break;
    }
    const minScore = (typeof CFG.localDbMinScore === 'number' && CFG.localDbMinScore >= 0.95) ? CFG.localDbMinScore : 0.95;
    // reject short/noisy DB hits that only share generic wording
    if (!best || best.score < minScore) return null;
    if ((best.answer || '').length < 1) return null;
    return best;
  }
  function learnLocalDb(qText, answer, type) {
    if (!qText || !answer) return;
    const db = loadLocalDb();
    const qn = normalizeForMatch(qText);
    for (let i = 0; i < Math.min(db.length, 500); i++) {
      if (simScore(qn, db[i].q) >= 0.98) { db[i].a = answer; db[i].type = type || db[i].type; saveLocalDb(db); return; }
    }
    db.unshift({ q: qText.slice(0, 800), a: String(answer).slice(0, 200), type: type || 'text', source: 'learned', t: Date.now() });
    saveLocalDb(db);
  }

  // ─────────────────────────────────────────────
  // LOCAL CODE CALCULATOR
  // ─────────────────────────────────────────────
  function tryLocalCodeCalc(qText, hasChoices) {
    if (!CFG.useCodeCalc || hasChoices) return null;
    const q = (qText || '').replace(/,/g, '');
    let expr = null;
    const m1 = q.match(/(?:^|\s)([-+]?\d+(?:\.\d+)?(?:\s*[+\-*/×÷^]\s*[-+]?\d+(?:\.\d+)?){1,8})\s*(?:\?|$|=)/);
    if (m1) expr = m1[1];
    if (!expr) { const m2 = q.match(/what is\s+([-+]?\d[\d\s+\-*/×÷^.()]*)\s*\??/i); if (m2) expr = m2[1]; }
    if (!expr) return null;
    expr = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/\^/g, '**').replace(/\s+/g, '');
    if (!/^[-+/*().0-9*]+$/.test(expr)) return null;
    try {
      // eslint-disable-next-line no-new-func
      const val = Function('"use strict"; return (' + expr + ')')();
      if (typeof val !== 'number' || !isFinite(val)) return null;
      return { answer: Number.isInteger(val) ? String(val) : String(Math.round(val * 1e10) / 1e10), confidence: 0.99, type: 'number', source: 'code_calc' };
    } catch (_) { return null; }
  }

  // ─────────────────────────────────────────────
  // AI (OpenAI)
  // ─────────────────────────────────────────────
  const FEW_SHOT = `
FEW-SHOT EXAMPLES:

Example 1 — fill-in arithmetic:
Q: What is 17 × 24?
{"answer":"408","confidence":0.99,"type":"number"}

Example 2 — single MC:
Q: Midpoint of (2,4) and (8,10)?
Choices: (5,7) | (6,6) | (4,8)
{"answer":"(5,7)","confidence":0.98,"type":"choice"}

Example 3 — multiselect:
Q: Select two that form a biconditional.
Choices: A | B | C | D | E | F
{"answer":["A","D"],"confidence":0.95,"type":"multiselect"}

Example 4 — dropdown (one blank):
Q: The process is called ___.
Blanks: [blank1]
Choices for blank1: photosynthesis | respiration | osmosis
{"answer":{"blank1":"photosynthesis"},"confidence":0.97,"type":"dropdown"}

Example 5 — text-highlight (select words in passage):
Q: Click the word that is an adverb.
Passage chunks: quickly | happy | run | the
{"answer":["quickly"],"confidence":0.96,"type":"text-highlight"}

Example 6 — choice-matrix (rows with A/B per row):
Q: Classify each statement as True or False.
Rows: ["The sun is a star", "The moon is a planet"]
Columns: ["True","False"]
{"answer":{"The sun is a star":"True","The moon is a planet":"False"},"confidence":0.98,"type":"choice-matrix"}

Example 7 — drag-drop (assign items to categories):
Q: Sort these items into the correct group.
Items: ["Dog","Cat","Eagle","Salmon"]
Drop zones: ["Mammals","Birds","Fish"]
{"answer":{"Dog":"Mammals","Cat":"Mammals","Eagle":"Birds","Salmon":"Fish"},"confidence":0.95,"type":"drag-drop"}
`.trim();

  function buildSystemPrompt(qtype) {
    return `You are an expert IXL tutor. Solve the question accurately.
Think step-by-step internally, then respond ONLY with a single JSON object — no markdown, no prose.

OUTPUT SHAPES by question type:
- fill-in / number: {"answer":"<value>","confidence":0.0-1.0,"type":"number|text"}
- single MC: {"answer":"<exact choice text>","confidence":0.0-1.0,"type":"choice"}
- multiselect: {"answer":["choice1","choice2"],"confidence":0.0-1.0,"type":"multiselect"}
- dropdown: {"answer":{"blank_label":"selected option"},"confidence":0.0-1.0,"type":"dropdown"}
- text-highlight: {"answer":["chunk text to click"],"confidence":0.0-1.0,"type":"text-highlight"}
- choice-matrix: {"answer":{"row label":"column label"},"confidence":0.0-1.0,"type":"choice-matrix"}
- drag-drop: {"answer":{"item text":"zone text"},"confidence":0.0-1.0,"type":"drag-drop"}

RULES:
- Use exact visible text from choices/chunks/rows/columns — never invent text.
- yes/no: answer exactly "yes" or "no".
- Fractions: answer as "<numerator>/<denominator>" or two separate values if asked.
- Logic: contrapositive = If ¬Q then ¬P. Biconditional = P ↔ Q.
- Negating inequalities: flip direction when dividing by negative.
- Geometry coordinates: (x,y) form.
Current question type: ${qtype}

${FEW_SHOT}`;
  }

  function isReasoningModel(name) {
    return /^(o1|o3|o4|gpt-5)/i.test(name) || /o1-|o3-|o4-/i.test(name);
  }

  function callOpenAI(prompt, qtype) {
    return new Promise((resolve, reject) => {
      if (!CFG.apiKey) { reject(new Error('No API key')); return; }
      const model = CFG.model || 'gpt-4o';
      const reasoning = CFG.useReasoningModel !== false && isReasoningModel(model);
      const sys = buildSystemPrompt(qtype || 'unknown');
      const messages = reasoning
        ? [{ role: 'user', content: sys + '\n\n---\n\n' + prompt }]
        : [{ role: 'system', content: sys }, { role: 'user', content: prompt }];
      const body = { model, messages };
      if (reasoning) body.max_completion_tokens = 4000;
      else { body.max_tokens = 600; body.temperature = 0.1; }

      GM_xmlhttpRequest({
        method: 'POST', url: CFG.apiBase,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CFG.apiKey },
        data: JSON.stringify(body), timeout: 120000,
        onload(res) {
          try {
            if (res.status !== 200) { reject(new Error(`API ${res.status}: ${res.responseText.slice(0, 200)}`)); return; }
            const data = JSON.parse(res.responseText);
            let content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';
            if (!content) { reject(new Error(`Empty AI content: ${JSON.stringify(data).slice(0, 200)}`)); return; }
            content = content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

            let parsed = null;
            const allObjs = content.match(/\{[\s\S]*?\}/g) || [];
            for (let i = allObjs.length - 1; i >= 0; i--) {
              try { const p = JSON.parse(allObjs[i]); if (p && p.answer != null) { parsed = p; break; } } catch (_) {}
            }
            if (!parsed) {
              const greedy = content.match(/\{[\s\S]*\}/);
              if (greedy) try { parsed = JSON.parse(greedy[0]); } catch (_) {}
            }
            if (!parsed) {
              const arr = content.match(/\[[\s\S]*?\]/);
              if (arr) try { const l = JSON.parse(arr[0]); if (Array.isArray(l) && l.length) parsed = { answer: l, confidence: 0.7, type: l.length > 1 ? 'multiselect' : 'choice' }; } catch (_) {}
            }
            if (!parsed) {
              const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
              const last = lines[lines.length - 1] || '';
              if (last && last.length < 400 && !/^work:|^step/i.test(last))
                parsed = { answer: last.replace(/^answer\s*[:=]\s*/i, '').replace(/^["']|["']$/g, ''), confidence: 0.55, type: 'text' };
            }
            if (!parsed) { reject(new Error(`No JSON in response: ${content.slice(0, 200)}`)); return; }
            resolve(parsed);
          } catch (e) { reject(e); }
        },
        onerror() { reject(new Error('Network error')); },
        ontimeout() { reject(new Error('OpenAI timeout')); }
      });
    });
  }

  // ─────────────────────────────────────────────
  // WOLFRAM (optional, fill-in only)
  // ─────────────────────────────────────────────
  function callWolfram(qText) {
    return new Promise(resolve => {
      if (!CFG.useWolfram || !(CFG.wolframAppId || '').trim()) { resolve(null); return; }
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://api.wolframalpha.com/v1/result?appid=${encodeURIComponent(CFG.wolframAppId.trim())}&i=${encodeURIComponent((qText || '').slice(0, 400))}`,
        timeout: 10000,
        onload(res) {
          if (res.status !== 200) { resolve(null); return; }
          const ans = (res.responseText || '').trim();
          if (!ans || /did not understand|no short result/i.test(ans)) { resolve(null); return; }
          resolve({ answer: ans.slice(0, 200), confidence: 0.95, type: 'text', source: 'wolfram' });
        },
        onerror() { resolve(null); }, ontimeout() { resolve(null); }
      });
    });
  }

  // ─────────────────────────────────────────────
  // SOLVE PIPELINE
  // ─────────────────────────────────────────────
  async function solveQuestion(qText, qtype, choices, prompt) {
    // 1. Local DB
    if (CFG.preferLocalDb) {
      const hit = searchLocalDb(qText);
      if (hit) { if (CFG.logSource) log(`[DB] hit score=${hit.score.toFixed(3)} → ${hit.answer}`, 'ok'); return hit; }
    }
    // 2. Code calc (fill-in only)
    const calc = tryLocalCodeCalc(qText, choices && choices.length > 0);
    if (calc) { if (CFG.logSource) log(`[calc] → ${calc.answer}`, 'ok'); return calc; }
    // 3. Wolfram (fill-in, compute-looking)
    if (CFG.useWolfram && !choices?.length && /[\d+\-*/×÷^=]|what is|evaluate|simplify|solve for/i.test(qText)) {
      const w = await callWolfram(qText).catch(() => null);
      if (w) { if (CFG.logSource) log(`[wolfram] → ${w.answer}`, 'ok'); return w; }
    }
    // 4. OpenAI
    const ai = await callOpenAI(prompt, qtype);
    if (ai) { ai.source = 'openai'; if (CFG.logSource) log(`[AI] conf=${ai.confidence} → ${JSON.stringify(ai.answer)}`, 'ok'); }
    return ai;
  }

  // ─────────────────────────────────────────────
  // CHOICE MATCHING
  // ─────────────────────────────────────────────
  function normStr(s) {
    return (s || '').toLowerCase().replace(/[–—−]/g, '-').replace(/≤/g, '<=').replace(/≥/g, '>=')
      .replace(/≠/g, '!=').replace(/[^a-z0-9<=>!\-\/\(\)\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  function matchChoice(answer, choices) {
    if (!choices?.length || answer == null) return null;
    const an = normStr(String(answer));
    if (!an) return null;
    // exact normalized match only as definitive
    let t = choices.find(c => normStr(c.text) === an);
    if (t) return t;
    // yes/no aliases (exact token)
    if (/^(yes|true|y)$/.test(an)) { t = choices.find(c => /^(yes|true|y)$/i.test(c.text.trim())); if (t) return t; }
    if (/^(no|false|n)$/.test(an)) { t = choices.find(c => /^(no|false|n)$/i.test(c.text.trim())); if (t) return t; }
    // one-sided contains only when lengths are close (avoid matching short substring into long unrelated choice)
    t = choices.find(c => {
      const ct = normStr(c.text);
      if (!ct) return false;
      if (ct === an) return true;
      const shorter = ct.length < an.length ? ct : an;
      const longer = ct.length < an.length ? an : ct;
      if (shorter.length < 4) return false;
      if (!longer.includes(shorter)) return false;
      return shorter.length / longer.length >= 0.72;
    });
    if (t) return t;
    // token Jaccard-like score — high threshold
    const tokens = an.split(/[^a-z0-9]+/).filter(w => w.length > 1);
    if (tokens.length >= 3) {
      let best = null, bestScore = 0;
      for (const c of choices) {
        const ct = normStr(c.text);
        const hit = tokens.filter(tk => ct.includes(tk)).length;
        const score = hit / tokens.length;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (best && bestScore >= 0.85) return best;
    }
    return null;
  }

  function matchChoiceMulti(answerList, choices) {
    const seen = new Set();
    return answerList
      .map(a => matchChoice(a, choices))
      .filter(m => m && !seen.has(m.el) && seen.add(m.el));
  }

  // ─────────────────────────────────────────────
  // QUESTION-TYPE-SPECIFIC APPLY HANDLERS
  // ─────────────────────────────────────────────

  async function applyMultipleChoice(result, choices, forceWrong) {
    const isMulti = result.type === 'multiselect' || Array.isArray(result.answer);
    let answerList = isMulti
      ? (Array.isArray(result.answer) ? result.answer : [result.answer]).map(a => String(a).trim())
      : [String(result.answer || '').trim()];

    if (forceWrong && choices.length > 1) {
      const wrongs = choices.filter(c => !answerList.some(a => normStr(c.text) === normStr(a)));
      if (wrongs.length) { answerList = [wrongs[rand(0, wrongs.length - 1)].text]; log('Intentional miss: ' + answerList[0], 'err'); }
    }

    const targets = isMulti ? matchChoiceMulti(answerList, choices) : (() => { const t = matchChoice(answerList[0], choices); return t ? [t] : []; })();
    if (!targets.length) {
      log(`No match for "${answerList.join(' | ')}" among: ${choices.map(c => c.text).join(' | ')}`, 'err');
      return false;
    }
    log(`Clicking (${targets.length}): ${targets.map(t => `"${t.text}"`).join(', ')}`, 'ok');

    for (let i = 0; i < targets.length; i++) {
      const el = resolveClickTarget(targets[i].el) || targets[i].el;
      const ok = await trustedClickEl(el);
      if (ok) {
        let sel = await waitForSelected(el, 2000);
        if (!sel) { await trustedClickEl(el); sel = await waitForSelected(el, 1200); }
        if (!sel) { nativeFallbackClick(el, 0, 0); sel = await waitForSelected(el, 1000); }
        if (!sel) log(`Selection uncertain for: ${targets[i].text}`, 'err');
      } else {
        // highlight for manual click
        el.style.outline = '3px solid #00e676';
        el.style.boxShadow = '0 0 12px rgba(0,230,118,0.7)';
        el.setAttribute('data-cinder-hl', '1');
      }
      if (i < targets.length - 1) await sleep(rand(200, 450));
    }
    return true;
  }

  function parseMultiBlankAnswer(answer) {
    // AI may return string, array, or {blank0:..,blank1:..}
    if (answer == null) return [];
    if (Array.isArray(answer)) return answer.map(a => String(a).trim());
    if (typeof answer === 'object') {
      return Object.keys(answer).sort().map(k => String(answer[k]).trim());
    }
    const s = String(answer).trim();
    // "a | b" or "a ; b" multi-blank conventions
    if (/\s[|;]\s/.test(s)) return s.split(/\s*[|;]\s*/).map(x => x.trim()).filter(Boolean);
    return [s];
  }

  async function applyFillIn(answer, inputs, isWrong) {
    const root = getQuestionRoot();
    let list = (inputs || []).filter(el => el && !isInsideSolverPanel(el) && isPlausibleAnswerControl(el));
    if (root) list = list.filter(el => root.contains(el));
    if (!list.length) list = getFillInInputs(root);
    list = list.filter(el => !isInsideSolverPanel(el) && isPlausibleAnswerControl(el));
    if (!list.length) {
      log('applyFillIn: no answer controls in question root', 'err');
      return false;
    }

    let parts = parseMultiBlankAnswer(answer);
    if (isWrong && parts.length) {
      parts = parts.map(p => {
        const n = parseFloat(p);
        return Number.isFinite(n) ? String(n + 1) : (p + 'x');
      });
    }

    // Map answers to fields: N blanks get N answers; 1 answer + 1 field; multi field + 1 answer → first field only
    const n = list.length;
    if (parts.length === 1 && n > 1) {
      // Prefer marked fillIns only when single answer (avoid stamping same into every blank)
      const marked = list.filter(el => /fillIn|fill-in|science-fill|answer/i.test(String(el.className || '') + (el.getAttribute('aria-label') || '')));
      list = (marked.length ? marked : list).slice(0, 1);
    } else if (parts.length > 1) {
      list = list.slice(0, Math.min(n, parts.length, 6));
    } else {
      list = list.slice(0, 1);
    }

    log(`applyFillIn targets=${list.length} answers=${JSON.stringify(parts)}`);
    let allOk = true;
    for (let i = 0; i < list.length; i++) {
      const input = list[i];
      const text = parts[Math.min(i, parts.length - 1)];
      const id = input.id || input.getAttribute('aria-label') || input.className || ('idx' + i);
      let result = await writeFieldValue(input, text);
      if (!result.ok) {
        // one bounded retry with fresh reference
        const refreshed = getFillInInputs(root).filter(el => !isInsideSolverPanel(el));
        const again = refreshed[i] || input;
        result = await writeFieldValue(again, text);
      }
      if (!result.ok || !valuesMatchExact(result.observed, text)) {
        log(`VERIFY FAIL field="${id}" intended="${text}" observed="${result.observed}" method=${result.method}`, 'err');
        allOk = false;
      } else {
        log(`VERIFY OK field="${id}" value="${result.observed}" method=${result.method}`, 'ok');
      }
      await sleep(rand(80, 160));
    }
    return allOk;
  }

  async function applyDropdown(result, dropdowns) {
    // result.answer = {blank_label: option_text} or string if only one dropdown
    const { triggers, nativeSelects } = dropdowns;
    const answers = typeof result.answer === 'object' && !Array.isArray(result.answer)
      ? result.answer : { blank0: String(result.answer) };

    // native selects (easier)
    for (let i = 0; i < nativeSelects.length; i++) {
      const sel = nativeSelects[i];
      const key = Object.keys(answers)[i] || Object.keys(answers)[0];
      const val = answers[key];
      const opt = [...sel.options].find(o => normStr(o.text) === normStr(val));
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); log(`Native select: ${opt.text}`, 'ok'); }
      else log(`Option not found: "${val}" in select #${i}`, 'err');
    }

    // custom IXL dropdowns: click trigger → pick from listbox
    for (let i = 0; i < triggers.length; i++) {
      const trigger = triggers[i];
      const key = Object.keys(answers)[i] || Object.keys(answers)[0];
      const val = answers[key];
      await trustedClickEl(trigger);
      await sleep(500); // wait for listbox to render
      const options = getDropdownOptions(trigger);
      const opt = options.find(o => normStr(o.text) === normStr(val));
      if (opt) { await trustedClickEl(opt.el); log(`Dropdown select: ${opt.text}`, 'ok'); }
      else {
        log(`Dropdown option not found: "${val}" among: ${options.map(o => o.text).join(' | ')}`, 'err');
        // close dropdown
        await trustedClickEl(trigger);
      }
      await sleep(300);
    }
    return true;
  }

  async function applyTextHighlight(result) {
    // result.answer = array of chunk texts to click
    const targets = Array.isArray(result.answer) ? result.answer : [String(result.answer)];
    const root = getQuestionRoot();
    const chunks = getTextHighlightChunks(root);
    if (!chunks.length) {
      log('applyTextHighlight: no chunks in question root', 'err');
      return false;
    }
    let anyVerified = false;
    for (const ansText of targets) {
      const match = chunks.find(c => normStr(c.text) === normStr(ansText))
        || chunks.find(c => normStr(c.text).includes(normStr(ansText)) || normStr(ansText).includes(normStr(c.text)));
      if (!match) {
        log(`Chunk not found: "${ansText}" among: ${chunks.map(c => c.text).join(' | ')}`, 'err');
        continue;
      }
      // Single deliberate click — blind second click caused duplicate CDP clicks 2s apart
      const clickOk = await trustedClickEl(match.el);
      let sel = await waitForSelected(match.el, 2500);
      if (!sel) {
        const cls = String(match.el.className || '');
        const aria = (match.el.getAttribute && (match.el.getAttribute('aria-selected') || match.el.getAttribute('aria-pressed'))) || '';
        sel = /selected|highlighted|active/i.test(cls) || String(aria).toLowerCase() === 'true';
      }
      // One native fallback only if still unselected (not a second trusted click)
      if (!sel && clickOk) {
        try {
          const r = match.el.getBoundingClientRect();
          nativeFallbackClick(match.el, r.left + r.width / 2, r.top + r.height / 2);
        } catch (_) {}
        sel = await waitForSelected(match.el, 1200);
      }
      if (sel) {
        log(`Highlight VERIFIED: "${match.text}"`, 'ok');
        anyVerified = true;
      } else {
        log(`Highlight attempted but selection not observed: "${match.text}" (clickOk=${!!clickOk})`, 'err');
      }
      await sleep(rand(120, 250));
    }
    return anyVerified;
  }

  async function applyChoiceMatrix(result) {
    // result.answer = {row_label: column_label}
    const rowAnswers = typeof result.answer === 'object' && !Array.isArray(result.answer)
      ? result.answer : {};
    const rows = getChoiceMatrixRows();
    for (const row of rows) {
      const colLabel = rowAnswers[row.label] || rowAnswers[Object.keys(rowAnswers)[0]];
      if (!colLabel) continue;
      const cell = row.cells.find(c => normStr(c.text) === normStr(colLabel))
        || row.cells.find(c => normStr(c.text).includes(normStr(colLabel)));
      if (cell) {
        await trustedClickEl(cell.el);
        log(`Matrix row "${row.label}" → "${cell.text}"`, 'ok');
      } else {
        log(`Matrix cell not found: "${colLabel}" for row "${row.label}"`, 'err');
      }
      await sleep(rand(150, 300));
    }
    return true;
  }

  async function applyDragDrop(result) {
    const itemMap = typeof result.answer === 'object' && !Array.isArray(result.answer)
      ? result.answer : null;
    if (!itemMap) {
      log('applyDragDrop: answer is not a {item:zone} map', 'err');
      return false;
    }
    const root = getQuestionRoot();
    const draggables = getDraggables(root);
    const zones = getDropZones(root);
    log(`Drag inventory items=${draggables.length} zones=${zones.length} zoneLabels=${zones.map(z => z.text).join(' | ')}`);
    const { placements, failures } = mapDragAnswer(itemMap, draggables, zones);
    for (const f of failures) log(`Drag ${f.code} ${f.role}: "${f.label}"`, 'err');
    if (!placements.length) return false;

    let verified = 0;
    for (const { item, zone } of placements) {
      const before = normStr(zone.el.innerText || '');
      const itemRect = item.el.getBoundingClientRect();
      const zoneRect = zone.el.getBoundingClientRect();
      const ix = itemRect.left + itemRect.width / 2, iy = itemRect.top + itemRect.height / 2;
      const zx = zoneRect.left + zoneRect.width / 2, zy = zoneRect.top + zoneRect.height / 2;
      const dt = new DataTransfer();
      item.el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ix, clientY: iy }));
      await sleep(rand(40, 90));
      zone.el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: zx, clientY: zy }));
      zone.el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: zx, clientY: zy }));
      item.el.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await sleep(80);
      const held = zoneHoldsItem(zone.el, item.text) || normStr(zone.el.innerText || '') !== before;
      if (held) {
        verified++;
        log(`Drag VERIFIED "${item.text}" → "${zone.text}"`, 'ok');
      } else {
        log(`Drag dispatched but placement not observed "${item.text}" → "${zone.text}"`, 'err');
      }
    }
    return verified === placements.length && failures.length === 0;
  }

  async function applyFraction(result, inputs) {
    const root = getQuestionRoot();
    let list = (inputs || []).filter(el => el && !isInsideSolverPanel(el) && isPlausibleAnswerControl(el));
    if (root) list = list.filter(el => root.contains(el));
    if (!list.length) list = getFillInInputs(root);
    list = list.filter(el => !isInsideSolverPanel(el));
    let num = '', den = '';
    if (typeof result.answer === 'string' && result.answer.includes('/')) {
      [num, den] = result.answer.split('/').map(s => s.trim());
    } else if (typeof result.answer === 'object' && !Array.isArray(result.answer)) {
      num = String(result.answer.numerator || result.answer.num || result.answer.top || '');
      den = String(result.answer.denominator || result.answer.den || result.answer.bottom || '');
    } else {
      num = String(result.answer || '');
    }
    if (list.length >= 2 && num && den) {
      const r0 = await writeFieldValue(list[0], num);
      const r1 = await writeFieldValue(list[1], den);
      const ok = r0.ok && r1.ok && valuesMatchExact(r0.observed, num) && valuesMatchExact(r1.observed, den);
      log(`Fraction ${num}/${den} verified=${ok} got=${r0.observed}/${r1.observed}`, ok ? 'ok' : 'err');
      return ok;
    }
    if (list.length >= 1) {
      const t = num || String(result.answer);
      const r0 = await writeFieldValue(list[0], t);
      return r0.ok && valuesMatchExact(r0.observed, t);
    }
    log('applyFraction: no targets in question root', 'err');
    return false;
  }

  // ─────────────────────────────────────────────
  // MAIN SOLVE CYCLE
  // ─────────────────────────────────────────────
  async function solveCurrent() {
    const root = getQuestionRoot();
    const qText = extractQuestionText();
    if (!qText || qText.length < 8) { log('No question text', 'err'); return null; }

    const qtype = detectQuestionType(root);
    log(`Question type: ${qtype}`);

    // gather context for AI prompt
    let choices = [];
    let promptExtra = '';

    switch (qtype) {
      case QType.MULTIPLE_CHOICE: {
        choices = getMultipleChoices(root);
        const isMulti = /select\s+(two|three|four|all|both)\b|select all that apply|choose\s+(two|three|all|both)\b|which\s+(two|three)\b|more than one/i.test(qText);
        if (isMulti) {
          promptExtra = `\nThis is MULTISELECT. Return: {"answer":["exact text","exact text"],"confidence":0.0-1.0,"type":"multiselect"}\nInclude ALL correct choices.`;
        } else {
          promptExtra = `\nReturn: {"answer":"<exact choice text>","confidence":0.0-1.0,"type":"choice"}`;
        }
        break;
      }
      case QType.FILL_IN:
        promptExtra = `\nReturn: {"answer":"<value>","confidence":0.0-1.0,"type":"number|text"}`;
        break;
      case QType.FRACTION:
        promptExtra = `\nThis is a FRACTION answer. Return: {"answer":"<numerator>/<denominator>","confidence":0.0-1.0,"type":"fraction"} or if whole number: {"answer":"<number>","confidence":0.0-1.0,"type":"number"}`;
        break;
      case QType.DROPDOWN: {
        const { triggers, nativeSelects } = getDropdowns();
        const allDropdowns = [...nativeSelects, ...triggers];
        const ddLabels = allDropdowns.map((el, i) => {
          const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || `blank${i}`;
          let optionTexts = [];
          if (el.tagName === 'SELECT') optionTexts = [...el.options].map(o => o.text.trim()).filter(Boolean);
          return `${label}: [${optionTexts.join(' | ')}]`;
        });
        promptExtra = `\nDropdown blanks:\n${ddLabels.join('\n')}\nReturn: {"answer":{"<blank label>":"<option>"},"confidence":0.0-1.0,"type":"dropdown"}`;
        break;
      }
      case QType.TEXT_HIGHLIGHT: {
        const chunks = getTextHighlightChunks();
        promptExtra = `\nPassage chunks to select from:\n${chunks.map(c => c.text).join(' | ')}\nReturn: {"answer":["<exact chunk text>"],"confidence":0.0-1.0,"type":"text-highlight"}`;
        break;
      }
      case QType.CHOICE_MATRIX: {
        const rows = getChoiceMatrixRows();
        // get column headers from first row
        const cols = rows[0]?.cells.map(c => c.text) || [];
        promptExtra = `\nChoice matrix rows: ${rows.map(r => r.label).join(' | ')}\nColumns: ${cols.join(' | ')}\nReturn: {"answer":{"<row label>":"<column label>"},"confidence":0.0-1.0,"type":"choice-matrix"}`;
        break;
      }
      case QType.DRAG_DROP: {
        const items = getDraggables();
        const zones = getDropZones();
        promptExtra = `\nDrag items: ${items.map(d => d.text).join(' | ')}\nDrop zones: ${zones.map(z => z.text).join(' | ')}\nReturn: {"answer":{"<item>":"<zone>"},"confidence":0.0-1.0,"type":"drag-drop"}`;
        break;
      }
      case QType.GRAPH:
        log('Graph question — manual answer required', 'err');
        updateStatus('Graph question: manual answer needed');
        return null;
      default:
        promptExtra = `\nReturn: {"answer":"<value>","confidence":0.0-1.0,"type":"text"}`;
    }

    let prompt = `=== QUESTION ===\n${qText.trim()}\n`;
    if (choices.length) {
      prompt += `\n=== CHOICES ===\n${choices.map((c, i) => `${i + 1}) ${c.text}`).join('\n')}\n`;
    }
    prompt += promptExtra;
    prompt += '\n\nFINAL OUTPUT: ONE JSON OBJECT ONLY.';

    log(`Solving ${qtype} (${qText.slice(0, 60)}…)`);
    const result = await solveQuestion(qText, qtype, choices, prompt);
    if (result == null || result.answer == null || result.answer === '') { log('No answer from any source', 'err'); return null; }
    log(`${result.source || 'src'} → ${JSON.stringify(result)}`, 'ok');
    return { result, qtype, choices, qText };
  }

  async function applyAnswer(data, forceWrong = false) {
    const { result, qtype, choices, qText } = data;
    readLiveFlags();

    // clear any previous highlights
    document.querySelectorAll('[data-cinder-hl]').forEach(el => {
      el.style.outline = ''; el.style.boxShadow = ''; el.removeAttribute('data-cinder-hl');
    });

    let applied = false;
    switch (qtype) {
      case QType.MULTIPLE_CHOICE:
        applied = await applyMultipleChoice(result, choices, forceWrong);
        break;
      case QType.FILL_IN: {
        const inputs = getFillInInputs(getQuestionRoot());
        applied = await applyFillIn(result.answer, inputs, forceWrong);
        if (!applied) { log(`Type this → ${result.answer}`, 'ok'); updateStatus(`Type: ${result.answer}`); }
        break;
      }
      case QType.FRACTION: {
        const inputs = getFillInInputs(getQuestionRoot());
        applied = await applyFraction(result, inputs);
        break;
      }
      case QType.DROPDOWN:
        applied = await applyDropdown(result, getDropdowns());
        break;
      case QType.TEXT_HIGHLIGHT:
        applied = await applyTextHighlight(result);
        break;
      case QType.CHOICE_MATRIX:
        applied = await applyChoiceMatrix(result);
        break;
      case QType.DRAG_DROP:
        applied = await applyDragDrop(result);
        break;
      default:
        log(`Unknown type — answer: ${JSON.stringify(result.answer)}`, 'err');
        updateStatus(`Answer: ${JSON.stringify(result.answer)}`);
        return false;
    }

    if (!applied) return false;

    // Learn correct answer (DB won't be used for wrong ones)
    if (!forceWrong) learnLocalDb(qText, JSON.stringify(result.answer), qtype);

    // Evidence-based completion check before any submit path
    const root = getQuestionRoot();
    const mappedType = ({
      'multiple-choice': 'multiple-choice',
      'fill-in': 'fill-in',
      'fraction': 'fraction',
      'dropdown': 'dropdown',
      'text-highlight': 'text-highlight',
      'choice-matrix': 'choice-matrix',
      'drag-drop': 'drag-drop',
      'graph': 'graph-placement',
      'unknown': 'unknown'
    })[qtype] || qtype;
    const proc = QT_STORE.getProcedure(mappedType);
    const minSel = (result.type === 'multiselect' || Array.isArray(result.answer))
      ? (Array.isArray(result.answer) ? result.answer.length : 1) : 1;
    const completion = QT_COMP.verifyCompletion(mappedType, {
      root,
      intendedAnswer: result.answer,
      minSelected: minSel
    });
    log(`Completion[${mappedType}] complete=${completion.complete} evidence=${completion.evidence}` +
      (proc ? ` trust=${proc.trust} eligible=${proc.eligible}` : ''), completion.complete ? 'ok' : 'err');

    readLiveFlags();
    if (CFG.autoSubmit !== true) {
      updateStatus(completion.complete ? 'Suggested — review and submit' : 'Incomplete registration — fix before submit');
      log('Auto-submit OFF — answer applied, submit manually', 'ok');
      return true;
    }

    // Guarded submit path
    if (!submissionGuard.canSubmit(completion)) {
      log(`Submit blocked by guard state=${submissionGuard.state} evidence=${completion.evidence}`, 'err');
      updateStatus('Submit blocked — answer not registered');
      return false;
    }
    submissionGuard.recordSubmit();
    updateStatus('Submitting…');
    await sleep(rand(700, 1200));
    for (let attempt = 0; attempt < 2; attempt++) {
      if (pageLooksLikeIncomplete()) break;
      await sleep(attempt * 300);
      const btn = getSubmitButton();
      if (!btn) { await sleep(400); continue; }
      // Do NOT log pre-scroll coords — trustedClickEl scrolls and remeasures.
      // Pre-scroll Y (e.g. 564) vs post-scroll Y (e.g. 360) looked like a bug but was scroll drift.
      let ok = await trustedClickEl(btn);
      if (!ok) {
        const r2 = btn.getBoundingClientRect();
        const x2 = r2.left + r2.width / 2, y2 = r2.top + r2.height / 2;
        log(`Submit native fallback "${(btn.innerText || '').trim()}" @ ${Math.round(x2)},${Math.round(y2)}`);
        ok = nativeFallbackClick(btn, x2, y2);
      }
      if (ok) {
        // Independent post-click observation (not proof of server accept)
        const stillIncomplete = pageLooksLikeIncomplete();
        const explanation = pageLooksLikeExplanation();
        log(`Submit click dispatched; incomplete=${stillIncomplete} explanation=${explanation}`, ok && !stillIncomplete ? 'ok' : 'err');
        await sleep(900);
        if (await handleIncompleteIfPresent()) {
          log('Post-submit incomplete — recovery engaged', 'err');
          return false;
        }
        if (pageLooksLikeExplanation() || !pageLooksLikeIncomplete()) {
          submissionGuard.onResultOk();
        }
        break;
      }
    }
    return true;
  }

  // ─────────────────────────────────────────────
  // MAIN LOOP
  // ─────────────────────────────────────────────
  async function processOneQuestion() {
    if (!running || processing) return;
    const myRun = runId;
    processing = true;
    try {
      if (!isRunActive(myRun)) return;
      if (isTechDifficultyPage()) { await recoverFromTechDifficulty(); currentQuestionHash = ''; return; }
      await handleIncompleteIfPresent();
      if (!isRunActive(myRun)) return;
      await dismissExplanationIfPresent();
      if (!isRunActive(myRun)) return;

      const qText = extractQuestionText();
      if (!qText || qText.length < 8) return;

      // stability check: same text across 3 samples (~900ms)
      await sleep(450);
      if (extractQuestionText() !== qText) return;
      await sleep(450);
      if (extractQuestionText() !== qText) return;

      const h = hashStr(qText);
      if (h === currentQuestionHash) return;
      currentQuestionHash = h;
      if (sessionTerminalHash && sessionTerminalHash === h) {
        log('Skip question — recovery already exhausted for this hash', 'err');
        updateStatus('Skipped — prior recovery exhausted');
        return;
      }
      submissionGuard.reset();
      log('New question');
      try {
        const root0 = getQuestionRoot();
        const qtId = QT_STORE.matchDetection(root0, qText);
        const proc0 = QT_STORE.getProcedure(qtId);
        if (proc0) log(`QT registry: ${qtId} trust=${proc0.trust} conf=${proc0.confidence}`);
      } catch (_) {}

      // delay
      readLiveFlags();
      let delaySec;
      if (!CFG.delayEnabled) {
        delaySec = 2 + rand(0, 2);
        log(`Delay OFF — settle ${delaySec}s`);
      } else {
        let minD = parseInt((panel?.querySelector('#c-min') || document.getElementById('c-min'))?.value, 10);
        let maxD = parseInt((panel?.querySelector('#c-max') || document.getElementById('c-max'))?.value, 10);
        if (!isFinite(minD) || minD < 0) minD = CFG.minDelaySec ?? 0;
        if (!isFinite(maxD) || maxD < 0) maxD = CFG.maxDelaySec ?? 0;
        if (maxD < minD) { const t = minD; minD = maxD; maxD = t; }
        if (maxD > 3600) maxD = 3600;
        delaySec = minD === maxD ? minD : minD + rand(0, maxD - minD);
        log(`Thinking ${delaySec}s (${minD}–${maxD})`);
      }
      const waitEnd = Date.now() + delaySec * 1000;
      while (isRunActive(myRun) && Date.now() < waitEnd) {
        const left = Math.max(0, Math.ceil((waitEnd - Date.now()) / 1000));
        updateStatus((CFG.delayEnabled ? 'Thinking… ' : 'Settling… ') + left + 's');
        await sleep(Math.min(1000, waitEnd - Date.now()));
      }
      if (!isRunActive(myRun)) return;

      updateStatus('Solving…');
      let data = null;
      try { data = await solveCurrent(); }
      catch (e) { log(`Solve error: ${e.message}`, 'err'); updateStatus('Solve failed — retry in 20s'); await sleep(20000); currentQuestionHash = ''; return; }
      if (!data) { log('No data — retry in 15s', 'err'); updateStatus('No answer — retry in 15s'); await sleep(15000); currentQuestionHash = ''; return; }

      // verify question hasn't changed
      const nowText = extractQuestionText();
      if (nowText && data.qText) {
        const na = normStr(nowText).slice(0, 120), nb = normStr(data.qText).slice(0, 120);
        if (na && nb && na !== nb && !na.includes(nb.slice(0, 40)) && !nb.includes(na.slice(0, 40))) {
          log('Question changed during solve — skip', 'err'); currentQuestionHash = ''; return;
        }
      }

      readLiveFlags();
      const miss = shouldIntentionalMiss();
      if (miss) log(`Miss armed (${CFG.missMode})`, 'err');
      const applied = await applyAnswer(data, miss);
      questionsDoneThisSession++;
      if (miss && applied !== false) missesDoneThisSession++;

      // wait for question transition
      updateStatus(CFG.autoSubmit ? 'Waiting for next…' : 'Your turn — submit');
      const prevHash = currentQuestionHash;
      const waitUntil = Date.now() + 180000;
      while (isRunActive(myRun) && Date.now() < waitUntil) {
        await sleep(1200);
        if (isTechDifficultyPage()) break;
        await handleIncompleteIfPresent();
        await dismissExplanationIfPresent();
        const cur = extractQuestionText();
        if (cur && hashStr(cur) !== prevHash) {
          await sleep(400);
          const c2 = extractQuestionText();
          if (!c2 || c2 !== cur) continue;
          await sleep(400);
          if (extractQuestionText() === c2) break;
        }
      }
      currentQuestionHash = '';
      document.querySelectorAll('[data-cinder-hl]').forEach(el => { el.style.outline = ''; el.style.boxShadow = ''; el.removeAttribute('data-cinder-hl'); });
      if (isTechDifficultyPage()) { await recoverFromTechDifficulty(); currentQuestionHash = ''; }
    } catch (e) {
      log(`Error: ${e.message}`, 'err'); updateStatus('Error — check console'); currentQuestionHash = '';
      if (isTechDifficultyPage()) await recoverFromTechDifficulty();
    } finally {
      processing = false;
    }
  }

  function startWatcher() {
    if (solveTimer) clearInterval(solveTimer);
    solveTimer = setInterval(() => { if (running && !processing) processOneQuestion().catch(e => log(e.message, 'err')); }, 2500);
  }

  function startAntiIdle() {
    if (antiIdleTimer) clearInterval(antiIdleTimer);
    antiIdleTimer = setInterval(() => {
      if (!running) return;
      firePointerEvent('pointermove', document, rand(50, window.innerWidth - 50), rand(50, window.innerHeight - 50));
      if (Math.random() < 0.2) window.scrollBy(0, rand(-20, 20));
      lastActivity = Date.now();
    }, rand(25000, 45000));
  }

  // ─────────────────────────────────────────────
  // UI PANEL
  // ─────────────────────────────────────────────
  function buildPanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'cinder-ixl-panel';
    panel.innerHTML = `
      <div class="c-hdr">
        <span>Cinder IXL <small style="opacity:.7">v4.2.7</small></span>
        <button id="c-collapse" type="button">–</button>
      </div>
      <div class="c-body">
        <div class="c-row">
          <label>API Key</label>
          <input type="password" id="c-key" placeholder="sk-..." />
        </div>
        <div class="c-row">
          <label>Model</label>
          <select id="c-model">
            <option value="gpt-4o">gpt-4o (recommended)</option>
            <option value="gpt-4o-mini">gpt-4o-mini (cheap)</option>
            <option value="gpt-4.1-mini">gpt-4.1-mini</option>
            <option value="o4-mini">o4-mini (reasoning)</option>
            <option value="o1-mini">o1-mini (reasoning)</option>
          </select>
        </div>
        <div class="c-row">
          <label><input type="checkbox" id="c-delayon" ${CFG.delayEnabled !== false ? 'checked' : ''}/> Delay (sec)</label>
          <input type="number" id="c-min" value="${CFG.minDelaySec}" style="width:60px"/> –
          <input type="number" id="c-max" value="${CFG.maxDelaySec}" style="width:60px"/>
        </div>
        <div class="c-row">
          <label><input type="checkbox" id="c-autosub" ${CFG.autoSubmit ? 'checked' : ''}/> Auto-submit (needs Trusted Click ext)</label>
        </div>
        <div class="c-row">
          <label><input type="checkbox" id="c-use-rate" ${CFG.missMode === 'rate' ? 'checked' : ''}/> Miss rate</label>
          <input type="number" id="c-miss" value="${CFG.intentionalMissRate}" step="0.05" min="0" max="1" style="width:65px"/>
        </div>
        <div class="c-row">
          <label><input type="checkbox" id="c-use-count" ${CFG.missMode === 'count' ? 'checked' : ''}/> Miss count</label>
          <input type="number" id="c-misscount" value="${CFG.missCountTarget || 0}" step="1" min="0" max="50" style="width:65px"/>
        </div>
        <div class="c-row">
          <label><input type="checkbox" id="c-double" ${CFG.doubleCheck ? 'checked' : ''}/> Double-check AI</label>
        </div>
        <div class="c-row" style="border-top:1px solid #333;padding-top:6px;margin-top:4px">
          <label style="color:#ffb74d;cursor:pointer;user-select:none" id="c-exp-toggle">OPTIONS ▸</label>
          <div id="c-exp-body" style="display:none;margin-top:4px">
            <label><input type="checkbox" id="c-prefer-db" ${CFG.preferLocalDb !== false ? 'checked' : ''}/> Prefer local Q/A DB</label>
            <label><input type="checkbox" id="c-fewshot" ${CFG.useFewShot !== false ? 'checked' : ''}/> Few-shot prompt</label>
            <label><input type="checkbox" id="c-codecalc" ${CFG.useCodeCalc !== false ? 'checked' : ''}/> Local code calc</label>
            <label><input type="checkbox" id="c-use-wolfram" ${CFG.useWolfram ? 'checked' : ''}/> Wolfram</label>
            <label>Wolfram AppID <input type="password" id="c-wolfram-id" value="${CFG.wolframAppId || ''}" style="width:100%"/></label>
            <label>Min confidence <input type="number" id="c-minconf" value="${CFG.minConfidenceToSubmit ?? 0.55}" step="0.05" min="0" max="1" style="width:65px"/></label>
            <label>DB entries: <span id="c-dbcount">0</span> <button type="button" id="c-db-clear" style="padding:2px 6px;font-size:10px">Clear</button></label>
          </div>
        </div>
        <div class="c-btns">
          <button id="c-save">Save</button>
          <button id="c-toggle" class="go">Start</button>
        </div>
        <div id="cinder-status" class="c-status">Idle</div>
        <div id="cinder-log" class="c-log"></div>
      </div>
    `;
    document.body.appendChild(panel);
    logEl = document.getElementById('cinder-log');

    // restore values
    document.getElementById('c-key').value = CFG.apiKey || '';
    document.getElementById('c-model').value = CFG.model || 'gpt-4o';

    const ur = document.getElementById('c-use-rate');
    const uc = document.getElementById('c-use-count');
    if (ur) ur.onchange = () => { if (ur.checked && uc) uc.checked = false; };
    if (uc) uc.onchange = () => { if (uc.checked && ur) ur.checked = false; };

    document.getElementById('c-save').onclick = () => {
      CFG.apiKey = document.getElementById('c-key').value.trim();
      CFG.model = document.getElementById('c-model').value;
      const parseN = (id, def) => { const v = parseFloat(document.getElementById(id)?.value); return isFinite(v) ? v : def; };
      CFG.minDelaySec = parseN('c-min', 30);
      CFG.maxDelaySec = parseN('c-max', 90);
      CFG.delayEnabled = !!document.getElementById('c-delayon')?.checked;
      CFG.intentionalMissRate = Math.max(0, Math.min(1, parseN('c-miss', 0)));
      CFG.missMode = document.getElementById('c-use-count')?.checked ? 'count' : document.getElementById('c-use-rate')?.checked ? 'rate' : 'off';
      CFG.missCountTarget = Math.max(0, parseInt(document.getElementById('c-misscount')?.value, 10) || 0);
      CFG.doubleCheck = !!document.getElementById('c-double')?.checked;
      CFG.autoSubmit = !!document.getElementById('c-autosub')?.checked;
      CFG.preferLocalDb = !!document.getElementById('c-prefer-db')?.checked;
      CFG.useFewShot = !!document.getElementById('c-fewshot')?.checked;
      CFG.useCodeCalc = !!document.getElementById('c-codecalc')?.checked;
      CFG.useWolfram = !!document.getElementById('c-use-wolfram')?.checked;
      CFG.wolframAppId = document.getElementById('c-wolfram-id')?.value.trim() || '';
      CFG.minConfidenceToSubmit = Math.max(0, Math.min(1, parseN('c-minconf', 0.55)));
      saveConfig(CFG);
      log('Config saved', 'ok');
    };

    // DB count
    try {
      const meta = GM_getValue(LOCAL_DB_META_KEY, null);
      const cntEl = document.getElementById('c-dbcount');
      if (cntEl) cntEl.textContent = String(meta?.count || loadLocalDb().length || 0);
      document.getElementById('c-db-clear').onclick = () => {
        saveLocalDb([]);
        if (cntEl) cntEl.textContent = '0';
        log('DB cleared', 'ok');
      };
    } catch (_) {}

    document.getElementById('c-toggle').onclick = () => {
      const btn = document.getElementById('c-toggle');
      if (!running) {
        runId += 1;
        running = true; processing = false; currentQuestionHash = '';
        sessionTerminalHash = '';
        missesDoneThisSession = 0; questionsDoneThisSession = 0; lastIncompleteAt = 0;
        submissionGuard.reset();
        if (solveTimer) clearInterval(solveTimer);
        if (antiIdleTimer) clearInterval(antiIdleTimer);
        btn.textContent = 'Stop'; btn.classList.replace('go', 'stop');
        startWatcher(); startAntiIdle();
        log('Solver started run=' + runId, 'ok'); updateStatus('Running');
        processOneQuestion();
      } else {
        runId += 1; // invalidate in-flight async
        running = false; processing = false; currentQuestionHash = '';
        if (solveTimer) { clearInterval(solveTimer); solveTimer = null; }
        if (antiIdleTimer) { clearInterval(antiIdleTimer); antiIdleTimer = null; }
        btn.textContent = 'Start'; btn.classList.replace('stop', 'go');
        log('Solver stopped (run invalidated)', 'ok'); updateStatus('Stopped');
      }
    };

    document.getElementById('c-collapse').onclick = () => {
      const b = panel.querySelector('.c-body');
      b.style.display = b.style.display === 'none' ? 'block' : 'none';
    };

    const expToggle = document.getElementById('c-exp-toggle');
    const expBody = document.getElementById('c-exp-body');
    if (expToggle) expToggle.onclick = () => {
      const open = expBody.style.display !== 'none';
      expBody.style.display = open ? 'none' : 'block';
      expToggle.textContent = open ? 'OPTIONS ▸' : 'OPTIONS ▾';
    };

    // drag
    let ox, oy, dragging = false;
    panel.querySelector('.c-hdr').addEventListener('mousedown', e => {
      if (e.target.id === 'c-collapse') return;
      dragging = true;
      const r = panel.getBoundingClientRect();
      ox = e.clientX - r.left; oy = e.clientY - r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const w = panel.offsetWidth || 300;
      const maxL = Math.max(0, window.innerWidth - w);
      const maxT = Math.max(0, window.innerHeight - 40);
      panel.style.left = Math.min(Math.max(0, e.clientX - ox), maxL) + 'px';
      panel.style.top = Math.min(Math.max(0, e.clientY - oy), maxT) + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  GM_addStyle(`
    #cinder-ixl-panel {
      position:fixed;top:72px;right:14px;width:300px;max-height:min(78vh,640px);
      background:#1a1a1e;color:#e0e0e0;border:1px solid #333;border-radius:10px;
      z-index:2147483646;font-family:system-ui,sans-serif;font-size:12px;
      box-shadow:0 8px 24px rgba(0,0,0,.45);display:flex;flex-direction:column;overflow:hidden;
    }
    #cinder-ixl-panel .c-hdr {
      background:#2d2d35;padding:7px 10px;display:flex;justify-content:space-between;
      align-items:center;cursor:move;user-select:none;font-weight:600;flex:0 0 auto;
    }
    #cinder-ixl-panel .c-hdr button { background:transparent;border:none;color:#aaa;font-size:16px;cursor:pointer; }
    #cinder-ixl-panel .c-body { padding:8px 10px;overflow-y:auto;flex:1 1 auto;min-height:0; }
    #cinder-ixl-panel .c-row { margin-bottom:6px; }
    #cinder-ixl-panel label { display:block;margin-bottom:2px;color:#aaa;font-size:11px; }
    #cinder-ixl-panel input[type="text"],
    #cinder-ixl-panel input[type="password"],
    #cinder-ixl-panel input[type="number"],
    #cinder-ixl-panel select {
      width:100%;box-sizing:border-box;background:#111;border:1px solid #444;
      color:#eee;padding:4px 7px;border-radius:5px;font-size:12px;
    }
    #cinder-ixl-panel .c-btns { display:flex;gap:8px;margin-top:8px; }
    #cinder-ixl-panel button {
      flex:1;padding:6px;border:none;border-radius:6px;cursor:pointer;
      font-weight:600;font-size:12px;
    }
    #cinder-ixl-panel #c-save { background:#3a3a45;color:#ddd; }
    #cinder-ixl-panel .go { background:#2e7d32;color:#fff; }
    #cinder-ixl-panel .stop { background:#c62828;color:#fff; }
    #cinder-ixl-panel .c-status { margin-top:6px;padding:2px 0;font-size:11px;color:#8bc34a; }
    #cinder-ixl-panel .c-log {
      margin-top:4px;max-height:120px;overflow-y:auto;font-family:ui-monospace,monospace;
      font-size:10px;background:#0d0d10;border-radius:4px;padding:4px;color:#bbb;
    }
    #cinder-ixl-panel #c-exp-body label { margin-top:3px; }
  `);

  // ─────────────────────────────────────────────
  // BOOT
  // ─────────────────────────────────────────────
  function init() {
    if (!/ixl\.com/i.test(location.hostname)) return;
    buildPanel();
    log('Paste API key → Save → Start');
    setTimeout(async () => {
      const ping = await callExt({ type: 'PING' }, 3000);
      if (ping?.ok || extReady || window.__CINDER_CLICK_EXT__) log('Trusted Click ext connected', 'ok');
      else log('Trusted Click ext not found — load cinder_click_ext and reload', 'err');
    }, 800);
    try { GM_registerMenuCommand('Toggle Cinder Panel', () => { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; }); } catch (_) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
