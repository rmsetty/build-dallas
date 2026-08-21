import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/site/AppShell";
import { EmptyState, ErrorState, LoadingRows, StatusBadge, cx } from "@/components/site/Primitives";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { EntityType, WikiEditRow, WikiEditableField } from "@/lib/database.types";
import { formatDateTime, titleCase } from "@/lib/format";

const TABLES: Record<EntityType, { table: "companies" | "events" | "people"; titleField: string }> =
  {
    company: { table: "companies", titleField: "name" },
    event: { table: "events", titleField: "title" },
    person: { table: "people", titleField: "name" },
  };

export const Route = createFileRoute("/wiki/$entityType/$entityId")({
  head: () => ({ meta: [{ title: "Suggest an edit — Build Dallas" }] }),
  component: WikiEntityPage,
});

type EntityRecord = Record<string, unknown>;

function isEntityType(value: string): value is EntityType {
  return value in TABLES;
}

function WikiEntityPage() {
  const params = Route.useParams();
  const entityId = params.entityId;
  // /wiki/anything-else is a 404 rather than a query against a table that
  // doesn't exist.
  if (!isEntityType(params.entityType)) throw notFound();
  const entityType = params.entityType;

  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const config = TABLES[entityType];

  const entity = useQuery({
    queryKey: ["wiki-entity", entityType, entityId],
    queryFn: async (): Promise<EntityRecord | null> => {
      const { data, error } = await supabase
        .from(config.table)
        .select("*")
        .eq("id", entityId)
        .maybeSingle();
      if (error) throw error;
      return data as EntityRecord | null;
    },
  });

  const fields = useQuery({
    queryKey: ["wiki-fields", entityType],
    queryFn: async (): Promise<WikiEditableField[]> => {
      const { data, error } = await supabase
        .from("wiki_editable_fields")
        .select("*")
        .eq("entity_type", entityType)
        .order("field_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const edits = useQuery({
    queryKey: ["wiki-edits", entityType, entityId],
    enabled: Boolean(user),
    queryFn: async (): Promise<WikiEditRow[]> => {
      const { data, error } = await supabase
        .from("wiki_edits")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const record = entity.data;
  const title = record ? String(record[config.titleField] ?? "Untitled") : "";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["wiki-entity", entityType, entityId] });
    queryClient.invalidateQueries({ queryKey: ["wiki-edits", entityType, entityId] });
    queryClient.invalidateQueries({ queryKey: ["wiki-recent"] });
    queryClient.invalidateQueries({
      queryKey: [entityType === "company" ? "companies" : "events"],
    });
  };

  if (entity.error) {
    return (
      <AppShell kicker="Wiki" title="Couldn't load that record.">
        <ErrorState error={entity.error} />
      </AppShell>
    );
  }

  if (entity.isPending) {
    return (
      <AppShell kicker="Wiki" title="Loading…">
        <LoadingRows count={3} />
      </AppShell>
    );
  }

  if (!record) {
    return (
      <AppShell kicker="Wiki" title="Not found.">
        <EmptyState
          title="No such record"
          body="This entry may have been merged into a duplicate or removed."
          action={
            <Link to="/wiki" className={cx.secondary}>
              Back to the wiki
            </Link>
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      kicker={`${titleCase(entityType)} record`}
      title={title}
      intro={
        <>
          Every field below is community-editable. Corroborated suggestions apply themselves — see{" "}
          <Link to="/wiki" className="font-medium text-primary hover:underline">
            how it works
          </Link>
          .
        </>
      }
      actions={
        entityType === "event" && record["url"] ? (
          <a
            href={String(record["url"])}
            target="_blank"
            rel="noreferrer noopener"
            className={cx.secondary}
          >
            View original ↗
          </a>
        ) : entityType === "company" && record["website"] ? (
          <a
            href={String(record["website"])}
            target="_blank"
            rel="noreferrer noopener"
            className={cx.secondary}
          >
            Website ↗
          </a>
        ) : undefined
      }
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          {!loading && !user && (
            <div className="rounded-2xl border border-border bg-card p-5 text-sm shadow-soft">
              <Link
                to="/login"
                search={{ redirect: "/wiki" }}
                className="font-medium text-primary hover:underline"
              >
                Sign in
              </Link>{" "}
              to suggest changes. Current values are public either way.
            </div>
          )}

          {fields.isPending ? (
            <LoadingRows count={3} />
          ) : (
            (fields.data ?? []).map((field) => (
              <FieldEditor
                key={field.field_name}
                field={field}
                entityId={entityId}
                current={record[field.field_name]}
                pending={(edits.data ?? []).filter(
                  (e) => e.field_name === field.field_name && e.status === "pending",
                )}
                canEdit={Boolean(user)}
                userId={user?.id ?? null}
                onSubmitted={invalidate}
              />
            ))
          )}
        </div>

        <aside className="space-y-4 self-start">
          <h2 className="text-2xl">Edit history</h2>
          {!user ? (
            <p className="rounded-2xl border border-dashed border-border bg-muted/40 px-5 py-8 text-center text-sm text-muted-foreground">
              Visible to signed-in members.
            </p>
          ) : edits.isPending ? (
            <LoadingRows count={2} />
          ) : (edits.data ?? []).length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-muted/40 px-5 py-8 text-center text-sm text-muted-foreground">
              No suggestions on this record yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {(edits.data ?? []).map((edit) => (
                <li
                  key={edit.id}
                  className="rounded-2xl border border-border bg-card p-4 shadow-soft"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{edit.field_name}</span>
                    <StatusBadge status={edit.status} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {edit.old_value ? `${edit.old_value} → ` : "set to "}
                    <span className="text-foreground">{edit.new_value ?? "(cleared)"}</span>
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatDateTime(edit.applied_at ?? edit.created_at)}
                    {edit.submitted_by === user?.id ? " · yours" : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </AppShell>
  );
}

function FieldEditor({
  field,
  entityId,
  current,
  pending,
  canEdit,
  userId,
  onSubmitted,
}: {
  field: WikiEditableField;
  entityId: string;
  current: unknown;
  pending: WikiEditRow[];
  canEdit: boolean;
  userId: string | null;
  onSubmitted: () => void;
}) {
  const currentText = Array.isArray(current)
    ? current.join(", ")
    : current == null
      ? ""
      : String(current);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentText);

  const mine = pending.find((e) => e.submitted_by === userId);
  const others = pending.filter((e) => e.submitted_by !== userId);

  const submit = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Sign in first.");
      // text[] fields go over the wire in Postgres array literal form; the
      // BEFORE trigger casts and validates before anything is applied.
      const normalized =
        field.value_type === "text[]"
          ? `{${value
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean)
              .map((v) => `"${v.replace(/"/g, '\\"')}"`)
              .join(",")}}`
          : value.trim();

      const payload = {
        entity_type: field.entity_type,
        entity_id: entityId,
        field_name: field.field_name,
        new_value: normalized,
        submitted_by: userId,
      };

      // One pending suggestion per user per field is a unique index, so revising
      // means updating the existing row rather than inserting a second one.
      const { error } = mine
        ? await supabase.from("wiki_edits").update({ new_value: normalized }).eq("id", mine.id)
        : await supabase.from("wiki_edits").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      setOpen(false);
      onSubmitted();
    },
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="kicker text-muted-foreground">
            {field.field_name.replace(/_/g, " ")}
          </span>
          <p className="mt-2 break-words text-sm">
            {currentText || <span className="text-muted-foreground">— not set —</span>}
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setValue(mine?.new_value ?? currentText);
              setOpen((v) => !v);
            }}
            className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
          >
            {open ? "Cancel" : mine ? "Revise suggestion" : "Suggest"}
          </button>
        )}
      </div>

      {(mine || others.length > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
          <StatusBadge status="pending" />
          {mine && <span>Your suggestion: {mine.new_value}</span>}
          {others.length > 0 && (
            <span>
              {others.length} other pending suggestion{others.length === 1 ? "" : "s"} — agreeing
              with one applies it.
            </span>
          )}
        </div>
      )}

      {open && (
        <form
          className="mt-4 space-y-3 border-t border-border pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          {field.allowed_values ? (
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={`w-full ${cx.select}`}
            >
              <option value="">— choose a value —</option>
              {field.allowed_values.map((v) => (
                <option key={v} value={v}>
                  {titleCase(v)}
                </option>
              ))}
            </select>
          ) : field.field_name === "description" ? (
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={4}
              className={`${cx.input} resize-y`}
            />
          ) : (
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={field.value_type === "text[]" ? "comma, separated, values" : ""}
              className={cx.input}
            />
          )}

          {submit.error && (
            <p className="text-sm text-destructive">
              {submit.error instanceof Error ? submit.error.message : String(submit.error)}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={submit.isPending} className={cx.primary}>
              {submit.isPending ? "Submitting…" : mine ? "Update suggestion" : "Submit suggestion"}
            </button>
            <p className="text-xs text-muted-foreground">
              Applies immediately if someone else already suggested the same value.
            </p>
          </div>
        </form>
      )}
    </section>
  );
}
