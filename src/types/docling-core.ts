/**
 * CoordOrigin.
 */
export type CoordOrigin = "TOPLEFT" | "BOTTOMLEFT";

/**
 * ContentLayer.
 */
export type ContentLayer = "body" | "furniture";

/**
 * CodeLanguageLabel.
 */
export type CodeLanguageLabel =
  | "Ada"
  | "Awk"
  | "Bash"
  | "bc"
  | "C"
  | "C#"
  | "C++"
  | "CMake"
  | "COBOL"
  | "CSS"
  | "Ceylon"
  | "Clojure"
  | "Crystal"
  | "Cuda"
  | "Cython"
  | "D"
  | "Dart"
  | "dc"
  | "Dockerfile"
  | "Elixir"
  | "Erlang"
  | "FORTRAN"
  | "Forth"
  | "Go"
  | "HTML"
  | "Haskell"
  | "Haxe"
  | "Java"
  | "JavaScript"
  | "Julia"
  | "Kotlin"
  | "LaTeX"
  | "Lua"
  | "MATLAB"
  | "Makefile"
  | "Markdown"
  | "Nim"
  | "OCaml"
  | "PHP"
  | "Pascal"
  | "Perl"
  | "PowerShell"
  | "Python"
  | "R"
  | "Ruby"
  | "Rust"
  | "SQL"
  | "Scala"
  | "Scheme"
  | "Shell"
  | "Swift"
  | "TypeScript"
  | "VB.NET"
  | "Verilog"
  | "VHDL"
  | "XML"
  | "YAML"
  | "Zig";

/**
 * ImageRefMode.
 */
export type ImageRefMode = "embedded" | "referenced" | "placeholder";

/**
 * TableCell.
 */
export interface TableCell {
  text: string;
  bbox?: BoundingBox;
  spans?: number[][];
  col_header?: boolean;
  row_header?: boolean;
  row_span?: number;
  col_span?: number;
}

/**
 * BoundingBox.
 */
export interface BoundingBox {
  l: number;
  t: number;
  r: number;
  b: number;
  coord_origin?: CoordOrigin;
}

/**
 * Size.
 */
export interface Size {
  width: number;
  height: number;
}

/**
 * DoclingDocument.
 */
export interface DoclingDocument {
  schema_name?: string;
  schema_version?: string;
  name: string;
  description?: string;
  logs?: LogEntry[];
  main_text?: NodeItem[];
  tables?: TableItem[];
  pictures?: PictureItem[];
  page_dimensions?: Size[];
  page_footers?: GroupItem[];
  page_headers?: GroupItem[];
  footnotes?: GroupItem[];
  captions?: GroupItem[];
  origin?: DocumentOrigin;
}

/**
 * LogEntry.
 */
export interface LogEntry {
  level: string;
  message: string;
}

/**
 * DocumentOrigin.
 */
export interface DocumentOrigin {
  filename?: string;
  mimetype?: string;
  binary_hash?: number;
}

/**
 * Base interface for all document items.
 */
export interface BaseItem {
  prov?: ProvenanceItem[];
  self_ref?: string;
  parent?: string;
}

/**
 * ProvenanceItem.
 */
export interface ProvenanceItem {
  page_no: number;
  bbox: BoundingBox;
}

/**
 * DocItem - Base class for document items.
 */
export interface DocItem extends BaseItem {
  label: string;
}

/**
 * NodeItem - Base class for hierarchical document items.
 */
export interface NodeItem extends DocItem {
  children?: NodeItem[];
}

/**
 * GroupItem - Container for grouped items.
 */
export interface GroupItem extends BaseItem {
  name: string;
  items: DocItem[];
}

/**
 * TextItem - Text content item.
 */
export interface TextItem extends DocItem {
  label:
    | "caption"
    | "checkbox_selected"
    | "checkbox_unselected"
    | "footnote"
    | "page_footer"
    | "page_header"
    | "paragraph"
    | "reference"
    | "text";
  text: string;
}

/**
 * SectionHeaderItem - Section header item.
 */
export interface SectionHeaderItem extends NodeItem {
  label: "section_header";
  text: string;
  level?: number;
}

/**
 * ListItem - List item.
 */
export interface ListItem extends NodeItem {
  label: "list_item";
  text: string;
  marker?: string;
  enumerated?: boolean;
}

/**
 * TableItem - Table item.
 */
export interface TableItem extends DocItem {
  label: "document_index" | "table";
  data: TableCell[][];
  num_rows?: number;
  num_cols?: number;
  table_cells?: TableCell[];
}

/**
 * PictureItem - Picture/image item.
 */
export interface PictureItem extends DocItem {
  label: "chart" | "picture";
  image?: ImageRef;
  annotations?: PictureAnnotation[];
}

/**
 * ImageRef - Reference to an image.
 */
export interface ImageRef {
  dpi?: number;
  size?: Size;
  uri?: string;
  mimetype?: string;
}

/**
 * Base interface for picture annotations.
 */
export interface PictureAnnotation {
  kind: string;
}

/**
 * PictureClassificationData - Picture classification annotation.
 */
export interface PictureClassificationData extends PictureAnnotation {
  kind: "classification";
  class_name: string;
  confidence?: number;
}

/**
 * PictureDescriptionData - Picture description annotation.
 */
export interface PictureDescriptionData extends PictureAnnotation {
  kind: "description";
  description: string;
}

/**
 * CodeItem - Code block item.
 */
export interface CodeItem extends DocItem {
  label: "code";
  text: string;
  language?: CodeLanguageLabel;
}
export interface PictureBarChartData extends PictureAnnotation {
  kind: "bar_chart_data";
}

export interface PictureLineChartData extends PictureAnnotation {
  kind: "line_chart_data";
}

export interface PicturePieChartData extends PictureAnnotation {
  kind: "pie_chart_data";
}

export interface PictureScatterChartData extends PictureAnnotation {
  kind: "scatter_chart_data";
}

export interface PictureStackedBarChartData extends PictureAnnotation {
  kind: "stacked_bar_chart_data";
}

export interface PictureMiscData extends PictureAnnotation {
  kind: "misc";
}

export interface PictureMoleculeData extends PictureAnnotation {
  kind: "molecule_data";
}

/**
 * Type guards for DocItem discrimination.
 */
export const isDocItem = {
  TextItem: (item: DocItem): item is TextItem =>
    [
      "caption",
      "checkbox_selected",
      "checkbox_unselected",
      "footnote",
      "page_footer",
      "page_header",
      "paragraph",
      "reference",
      "text",
    ].includes(item.label),

  SectionHeaderItem: (item: DocItem): item is SectionHeaderItem =>
    item.label === "section_header",

  ListItem: (item: DocItem): item is ListItem => item.label === "list_item",

  TableItem: (item: DocItem): item is TableItem =>
    ["document_index", "table"].includes(item.label),

  PictureItem: (item: DocItem): item is PictureItem =>
    ["chart", "picture"].includes(item.label),

  CodeItem: (item: DocItem): item is CodeItem => item.label === "code",
};

/**
 * Type guards for picture annotations.
 */
export const isPictureAnnotation = {
  Classification: (
    annotation: PictureAnnotation
  ): annotation is PictureClassificationData =>
    annotation.kind === "classification",

  Description: (
    annotation: PictureAnnotation
  ): annotation is PictureDescriptionData => annotation.kind === "description",

  BarChart: (
    annotation: PictureAnnotation
  ): annotation is PictureBarChartData => annotation.kind === "bar_chart_data",

  LineChart: (
    annotation: PictureAnnotation
  ): annotation is PictureLineChartData =>
    annotation.kind === "line_chart_data",

  PieChart: (
    annotation: PictureAnnotation
  ): annotation is PicturePieChartData => annotation.kind === "pie_chart_data",

  ScatterChart: (
    annotation: PictureAnnotation
  ): annotation is PictureScatterChartData =>
    annotation.kind === "scatter_chart_data",

  StackedBarChart: (
    annotation: PictureAnnotation
  ): annotation is PictureStackedBarChartData =>
    annotation.kind === "stacked_bar_chart_data",

  Misc: (annotation: PictureAnnotation): annotation is PictureMiscData =>
    annotation.kind === "misc",

  Molecule: (
    annotation: PictureAnnotation
  ): annotation is PictureMoleculeData => annotation.kind === "molecule_data",
};
