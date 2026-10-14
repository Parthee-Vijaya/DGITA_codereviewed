"use client";

import { useId } from "react";
import styles from "./DataCategoryFields.module.css";
import { Question, FieldErrorText } from "./ApplicationFields";
import { DATA_CATEGORY_OPTIONS, type PersonalDataCategory } from "./procurement";
import type { ApplicationFormState } from "./engine";

export function DataCategoryFields({ form, errorFor, onChange }: {
  form: ApplicationFormState;
  errorFor: (field: string) => string | undefined;
  onChange: (field: "personalDataCategories", value: PersonalDataCategory[]) => void;
}) {
  const errorId = useId();
  if (form.personalData !== "ja") return null;
  const selected = form.personalDataCategories ?? [];
  const error = errorFor("personalDataCategories");
  return <Question title="Hvilke kategorier af personoplysninger behandles?" hint="Vælg alle relevante kategorier. Kategorierne beskriver oplysningernes art og registreres særskilt fra klassifikationen af data. Undlad konkrete personoplysninger.">
    <div className={styles.options} role="group" aria-label="Personoplysningskategorier" aria-describedby={error ? errorId : undefined}>
      {DATA_CATEGORY_OPTIONS.map((option) => <label className={styles.option} key={option.value}>
        <input type="checkbox" checked={selected.includes(option.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => onChange("personalDataCategories", event.target.checked ? [...selected, option.value] : selected.filter((value) => value !== option.value))} />
        {option.label}
      </label>)}
    </div>
    <FieldErrorText id={errorId} message={error} />
  </Question>;
}
