import DataGrid, { GroupFormatterProps, SortColumn } from "react-data-grid";
import {
  Category,
  nextCategory,
  Schema,
  TestSchema,
  useRemoteDataHook,
} from "./datastore";
import groupBy from "lodash/groupBy";
import { useEffect, useMemo, useState } from "react";
import { DragAndDropGrouper, Group } from "./ColumnOrderAndGrouper";
import { CommitPicker } from "./CommitPicker";

const CATEGORY_PRECEDENCE: Readonly<Category[]> = ["bad", "flaky", "good"];
const DEFAULT_REMOVED = ["id", "botName"];
const DEFAULT_GROUPED = [
  "category",
  "file",
  "title",
  "browserName",
  "platform",
  "headful",
  "docker",
  "mode",
  "trace",
  "video",
  "nodejsVersion",
  "commit",
];
type Row = Schema<TestSchema>;
const rowKeyGetter = (row: Row) => row.id;

type Comparator = (a: Row, b: Row) => number;
function getComparator(sortColumn: keyof Row): Comparator {
  switch (sortColumn) {
    case "category":
      return (a, b) => {
        const [ai, bi] = [
          CATEGORY_PRECEDENCE.indexOf(a[sortColumn] as Category),
          CATEGORY_PRECEDENCE.indexOf(b[sortColumn] as Category),
        ];
        return ai === bi ? 0 : ai < bi ? -1 : 1;
      };
    case "video":
    case "trace":
    case "headful":
    case "docker":
      return (a, b) => {
        const [ai, bi] = [a[sortColumn], b[sortColumn]];
        return ai === bi ? 0 : ai ? -1 : 1;
      };
    case "platform":
    case "title":
    case "nodejsVersion":
    case "mode":
    case "file":
    case "browserName":
    case "commit":
    case "botName":
      return (a, b) => {
        return a[sortColumn].localeCompare(b[sortColumn]);
      };
    case "id":
      return (a, b) => {
        return a[sortColumn] - b[sortColumn];
      };
    default:
      throw new Error(`unsupported sortColumn: "${sortColumn}"`);
  }
}

const categoryClass = (category: Category) =>
  category ? `category__${category}` : "";

const groupFormatter = ({
  childRows,
  groupKey,
  row,
}: GroupFormatterProps<Row>) => {
  const category = childRows.reduce((acc, cur) => {
    return nextCategory(acc, cur.category as Category);
  }, "good" as Category);
  return (
    <>
      <div className={categoryClass(category)}>{groupKey as string}</div>
    </>
  );
};

export const SpecGrid: React.FC<{
  onLoadingChange: (loading: boolean) => void;
}> = ({ onLoadingChange }) => {
  const { isLoading, error, fetchCommit, db, commits } = useRemoteDataHook();
  const [grouped, setGrouped] = useState<string[]>(DEFAULT_GROUPED);
  const [ungrouped, setUngrouped] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>(DEFAULT_REMOVED);
  const [includeGood, setIncludeGood] = useState(false);
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>(() =>
    [...DEFAULT_GROUPED, ...DEFAULT_REMOVED].map((v) => ({
      columnKey: v,
      direction: "ASC",
    }))
  );
  const [expandedGroupIds, setExpandedGroupIds] = useState<
    ReadonlySet<unknown>
  >(() => new Set<unknown>([]));
  const [rows, setRows] = useState(() => db.records());

  useEffect(() => {
    onLoadingChange(isLoading);
  }, [isLoading]);
  useEffect(() => {
    if (error) window.alert(error);
  }, [error]);
  useEffect(() => {
    setRows(db.records());
  }, [db]);

  const sortedRows = useMemo((): readonly Row[] => {
    return [...rows]
      .filter((r) => (includeGood ? true : r.category !== "good"))
      .sort((a, b) => {
        for (const sort of sortColumns) {
          const comparator = getComparator(sort.columnKey as any);
          const compResult = comparator(a, b);
          if (compResult !== 0) {
            return sort.direction === "ASC" ? compResult : -compResult;
          }
        }
        return 0;
      });
  }, [rows, sortColumns, includeGood]);

  const columns = useMemo(() => {
    return [...grouped, ...ungrouped].map((v) => ({
      name: v,
      key: v,
      formatter:
        (db.schema() as any)[v] === "boolean"
          ? ({ row }) => <>{(row as any)[v].toString()}</>
          : undefined,
      width: v === "file" || v === "title" ? 400 : undefined,
      cellClass:
        v === "category"
          ? (row: Row) => categoryClass(row.category as any)
          : null,
      groupFormatter: grouped.includes(v as any) ? groupFormatter : undefined,
    }));
  }, [grouped, ungrouped, removed, db]);

  return (
    <>
      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        <div style={{ flexGrow: 1, display: "flex", alignItems: "center" }}>
          <div>
            <CommitPicker
              placeholder={isLoading ? "loading…" : "commit"}
              disabled={isLoading}
              onSubmit={(c) => {
                fetchCommit(c);
              }}
            />
          </div>
          <div>({[...commits].sort().join(", ") || "no commits loaded"})</div>
        </div>
        <div>
          <label>
            Inlcude Good Specs?
            <input
              type="checkbox"
              checked={includeGood}
              onChange={(e) => {
                setIncludeGood(e.target.checked);
              }}
            />
          </label>
        </div>
      </div>
      <DragAndDropGrouper
        selection={{
          grouped: grouped.map((v) => ({ id: v, name: v })),
          ungrouped: ungrouped.map((v) => ({ id: v, name: v })),
          removed: removed.map((v) => ({ id: v, name: v })),
        }}
        onChange={(s) => {
          setGrouped(s.grouped.map((v) => v.name));
          setUngrouped(s.ungrouped.map((v) => v.name));
          setRemoved(s.removed.map((v) => v.name));
        }}
      />
      <DataGrid
        columns={columns}
        rows={sortedRows}
        groupBy={grouped}
        rowGrouper={groupBy}
        rowKeyGetter={rowKeyGetter}
        expandedGroupIds={expandedGroupIds}
        onExpandedGroupIdsChange={setExpandedGroupIds}
        sortColumns={sortColumns}
        onSortColumnsChange={setSortColumns}
        defaultColumnOptions={{ resizable: true, sortable: true }}
        className="fill-grid"
      />
    </>
  );
};
