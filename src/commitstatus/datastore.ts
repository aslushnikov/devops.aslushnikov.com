import { useCallback, useEffect, useMemo, useState } from "react";

interface LiteralToType {
  string: string;
  boolean: boolean;
  number: number;
}

export type Category = "good" | "bad" | "flaky";

export type Schema<T extends { [key: string]: keyof LiteralToType }> = {
  [Property in keyof T]: LiteralToType[T[Property]];
};

class NormalizedDataBuilder<T extends { [key: string]: keyof LiteralToType }> {
  private _records: Schema<T>[] = [];

  private _schema: T;
  private _default: Schema<T>;

  constructor(schema: T) {
    this._schema = schema;
    const o: any = {};
    for (const [k, type] of Object.entries(schema)) {
      switch (type) {
        case "boolean":
          o[k] = false;
          break;
        case "string":
          o[k] = "";
          break;
        case "number":
          o[k] = 0;
          break;
        default:
          throw new Error(`Illegal schema type: type "${type}" for key "${k}"`);
      }
    }
    this._default = o;
  }

  add(o: Schema<T>) {
    const n = { ...this._default };
    for (const [key, type] of Object.entries(this._schema)) {
      const v = o[key];
      if (v === undefined) continue;
      if (typeof v !== type) throw new Error("illegal value for schema");
      (n as any)[key] = v;
    }

    this._records.push(n);
  }

  records(): {
    [Property in keyof T]: LiteralToType[T[Property]];
  }[] {
    return this._records;
  }

  remove(
    shouldRemove: (r: {
      [Property in keyof T]: LiteralToType[T[Property]];
    }) => boolean
  ): void {
    this._records = this._records.filter((r) => !shouldRemove(r));
  }

  schema(): Readonly<T> {
    return this._schema;
  }

  copy(): NormalizedDataBuilder<T> {
    const copy = new NormalizedDataBuilder(this._schema);
    copy._default = { ...this._default };
    copy._records = [...this._records];
    return copy;
  }
}

const getBotName = (test: any) => {
  const browserName = test.parameters.browserName || "N/A";
  const browserVersion = test.parameters.browserVersion || "";
  const platform = test.parameters.platform;
  const prefix =
    browserName && browserVersion
      ? browserName + " " + browserVersion
      : browserName;
  return [
    prefix,
    platform,
    ...Object.entries(test.parameters)
      .filter(
        ([key, value]) =>
          !!value &&
          key !== "platform" &&
          key !== "browserName" &&
          key !== "browserVersion"
      )
      .map(([key, value]) => {
        if (typeof value === "string") return value;
        if (typeof value === "boolean") return key;
        return `${key}=${value}`;
      }),
  ].join(" / ");
};

const getTestCategory = (test: any) => {
  const hasGoodRun = test.runs[test.expectedStatus] > 0;
  const hasBadRun =
    (test.expectedStatus !== "failed" && test.runs.failed > 0) ||
    (test.expectedStatus !== "timedOut" && test.runs.timedOut > 0);
  if (hasGoodRun && hasBadRun) return "flaky";
  if (hasBadRun) return "bad";
  return "good";
};

export const nextCategory = (prev: Category, current: Category) => {
  if (prev === "bad" || current === "bad") return "bad";
  if (prev === "flaky" || current === "flaky") return "flaky";
  if (current !== "good") throw new Error("unreachable");
  return "good";
};

export type TestSchema = {
  id: "number";
  botName: "string";
  browserName: "string";
  category: "string";
  docker: "boolean";
  file: "string";
  headful: "boolean";
  mode: "string";
  nodejsVersion: "string";
  platform: "string";
  title: "string";
  trace: "boolean";
  video: "boolean";
  commit: "string";
  total: "number";
};

const aggregate = (
  json: any,
  commit: string,
  db: NormalizedDataBuilder<TestSchema>
) => {
  const specs: any[] = [];
  const tests: any[] = [];
  const configurations = new Set();
  let id = 0;
  for (const entry of json) {
    for (const spec of entry.specs) {
      const specId = entry.file + "---" + spec.title;
      const specObject = {
        specId,
        file: entry.file,
        title: spec.title,
        line: spec.line,
        column: spec.column,
        configurationToTest: {},
        category: "-",
      };
      specs.push(specObject);
      for (const test of spec.tests || []) {
        if (test.parameters.channel) {
          test.parameters.browserName = test.parameters.channel;
          delete test.parameters.channel;
        }
        // By default, all tests are run under "default" mode unless marked differently.
        if (!test.parameters.mode) test.parameters.mode = "default";

        const testObject = {
          category: "-",
          specId,
          // spec: specObject,
          name: getBotName(test),
          browserName: test.parameters.browserName || "N/A",
          platform: test.parameters.platform,
          parameters: test.parameters,
          annotations: test.annotations || [],
          runs: {
            passed: test.passed || 0,
            skipped: test.skipped || 0,
            timedOut: test.timedOut || 0,
            failed: test.failed ? test.failed.length : 0,
          },
          errors: (test.failed || []).map((error: any) => ({
            // Sometimes we get an error object like this:
            // { "value: "Worker process exited unexpectedly" }
            stack: error.stack || error.value,
          })),
          hasErrors: test.failed?.length > 0,
          maxTime: test.maxTime, // max time with test passing
          expectedStatus: test.expectedStatus || "passed",
        };
        testObject.category = getTestCategory(testObject);

        db.add({
          id: ++id,
          botName: getBotName(test),
          file: specObject.file,
          title: specObject.title,
          category: testObject.category,
          browserName: test.parameters.browserName,
          docker: test.parameters.docker,
          headful: test.parameters.headful,
          mode: test.parameters.mode,
          nodejsVersion: test.parameters.nodejsVersion,
          platform: test.parameters.platform,
          trace: test.parameters.trace,
          video: test.parameters.video,
          commit: commit,
          total: 1,
        });
      }
    }
  }

  return db;
};

export const useRemoteDataHook = () => {
  const [initial] = useState(
    () =>
      new URL(window.location.href).searchParams
        .get("commits")
        ?.split(",")
        .filter((v) => !!v) || []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [commits, setCommits] = useState<Set<string>>(new Set());
  const [db, setDB] = useState(
    new NormalizedDataBuilder<TestSchema>({
      id: "number",
      botName: "string",
      browserName: "string",
      category: "string",
      docker: "boolean",
      file: "string",
      headful: "boolean",
      mode: "string",
      nodejsVersion: "string",
      platform: "string",
      title: "string",
      trace: "boolean",
      video: "boolean",
      commit: "string",
      total: "number",
    })
  );

  const fetchCommit = useCallback(
    async (...commitsToFetch: string[]) => {
      try {
        if (isLoading) throw new Error(`Already fetching!`);
        setIsLoading(true);

        const copy = db.copy();
        for (const commit of commitsToFetch) {
          const url = `https://folioflakinessdashboard.blob.core.windows.net/dashboards/compressed_v1/${encodeURIComponent(
            commit
          )}.json`;
          const json = await fetch(url)
            .then((r) => {
              if (r.status !== 200) {
                throw new Error(
                  `Error while fetching ${url}; expected 200, but got ${r.status}`
                );
              }
              return r;
            })
            .then((r) => r.json());
          copy.remove((r) => r.commit === commit);
          aggregate(json, commit, copy);
        }
        setCommits(new Set([...commitsToFetch, ...commits]));
        setDB(copy);
      } catch (e) {
        setError(e.toString());
      } finally {
        setIsLoading(false);
      }
    },
    [commits, db, isLoading]
  );

  useEffect(() => {
    if (initial.length) fetchCommit(...initial);
  }, [initial]);

  useEffect(() => {
    if (!commits.size) return;
    const o = new URL(window.location.href);
    o.search =
      "commits=" +
      [...commits]
        .sort()
        .map((v) => encodeURIComponent(v))
        .join(",");
    window.history.pushState({}, "", o);
  }, [commits]);

  return { commits, isLoading, error, fetchCommit, db };
};
