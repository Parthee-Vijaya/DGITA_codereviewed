"use client";

import { Children, cloneElement, createContext, isValidElement, type ReactElement, type ReactNode } from "react";

export const QuestionLabelContext = createContext<string | undefined>(undefined);
export const QuestionErrorContext = createContext<string | undefined>(undefined);
export const QuestionHintContext = createContext<string | undefined>(undefined);

export function describedBy(...ids: unknown[]) {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && Boolean(id)).flatMap((id) => id.split(/\s+/u)))].join(" ") || undefined;
}

/** Native controls retain explicit labels; otherwise inherit the question. */
export function labelQuestionControls(children: ReactNode, title: string, errorId?: string, hintId?: string): ReactNode {
  const labelledIds = new Set<unknown>();
  function collectLabels(nodes: ReactNode) {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child) || typeof child.type !== "string") return;
      const props = (child as ReactElement<Record<string, unknown>>).props;
      if (child.type === "label" && props.htmlFor) labelledIds.add(props.htmlFor);
      collectLabels(props.children as ReactNode);
    });
  }
  collectLabels(children);
  function containsLabelText(nodes: ReactNode): boolean {
    return Children.toArray(nodes).some((child) => {
      if (typeof child === "string" || typeof child === "number") return Boolean(String(child).trim());
      if (!isValidElement(child) || typeof child.type !== "string" || ["input", "select", "textarea", "svg"].includes(child.type)) return false;
      return containsLabelText((child as ReactElement<{ children?: ReactNode }>).props.children);
    });
  }
  function label(nodes: ReactNode, insideLabel = false): ReactNode {
    return Children.map(nodes, (child) => {
    if (!isValidElement(child) || typeof child.type !== "string") return child;
    const element = child as ReactElement<Record<string, unknown>>;
    const props = element.props;
    const control = ["input", "select", "textarea"].includes(child.type) && props.type !== "hidden";
    const invalid = typeof props.className === "string" && props.className.split(" ").includes("invalid");
    return cloneElement(element, {
      ...(control && !insideLabel && !labelledIds.has(props.id) && !props["aria-label"] && !props["aria-labelledby"] ? { "aria-label": title } : {}),
      ...(control && invalid ? { "aria-invalid": true } : {}),
      ...(control ? { "aria-describedby": describedBy(props["aria-describedby"], hintId, invalid ? errorId : undefined) } : {}),
      ...(props.children ? { children: label(props.children as ReactNode, insideLabel || (child.type === "label" && containsLabelText(props.children as ReactNode))) } : {}),
    });
    });
  }
  return label(children);
}
