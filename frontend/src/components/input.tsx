import type { InputHTMLAttributes, ReactElement } from "react";

/** A required text field in the app's form style. */
export function Input(props: InputHTMLAttributes<HTMLInputElement>): ReactElement {
  return <input required className="w-full rounded border p-2" {...props} />;
}
