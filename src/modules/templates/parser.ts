import { ValidationError } from "@/server/errors";
import { ALLOWED_TEMPLATE_VARIABLES, type TemplateVariable } from "./types";

export { ALLOWED_TEMPLATE_VARIABLES, type TemplateVariable };

export interface ParsedTemplate {
  variablesUsed: string[];
  unknownVariables: string[];
}

export interface ExtractedVariable {
  name: string;
  isOptional: boolean;
  raw: string;
}

export function extractTemplateVariables(text: string): ExtractedVariable[] {
  const matches = text.matchAll(/\{\{([a-zA-Z0-9_:]+)\}\}/g);
  const result: ExtractedVariable[] = [];
  for (const match of matches) {
    const raw = match[0];
    const inner = match[1];
    const isOptional = inner.endsWith(":optional");
    const name = isOptional ? inner.replace(":optional", "") : inner;
    if (!result.some((r) => r.raw === raw)) {
      result.push({ name, isOptional, raw });
    }
  }
  return result;
}

export function parseTemplateVariables(text: string): ParsedTemplate {
  const matches = text.matchAll(/\{\{([a-zA-Z0-9_:]+)\}\}/g);
  const variablesUsed: string[] = [];
  const unknownVariables: string[] = [];

  for (const match of matches) {
    const rawVar = match[1];
    const isOptional = rawVar.endsWith(":optional");
    const cleanVar = isOptional ? rawVar.replace(":optional", "") : rawVar;

    if (!ALLOWED_TEMPLATE_VARIABLES.includes(cleanVar as TemplateVariable)) {
      if (!unknownVariables.includes(rawVar)) {
        unknownVariables.push(rawVar);
      }
    } else {
      if (!variablesUsed.includes(rawVar)) {
        variablesUsed.push(rawVar);
      }
    }
  }

  return { variablesUsed, unknownVariables };
}

export function validateTemplateText(subject: string | null | undefined, body: string): string[] {
  const combined = `${subject || ""} ${body}`;
  const { variablesUsed, unknownVariables } = parseTemplateVariables(combined);

  if (unknownVariables.length > 0) {
    throw new ValidationError(
      `Disallowed template variables: ${unknownVariables.map((v) => `{{${v}}}`).join(", ")}. Allowed: ${ALLOWED_TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(", ")}`
    );
  }

  return variablesUsed;
}

export function renderTemplate(
  body: string,
  variables: Record<string, string | undefined> = {},
  context: {
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
    setterName?: string | null;
    closerName?: string | null;
    workspaceName?: string | null;
    meetingUrl?: string | null;
  } = {}
): string {
  const { variablesUsed, unknownVariables } = parseTemplateVariables(body);
  if (unknownVariables.length > 0) {
    throw new ValidationError(`Cannot render template with unknown variables: ${unknownVariables.join(", ")}`);
  }

  let rendered = body;

  for (const rawVar of variablesUsed) {
    const isOptional = rawVar.endsWith(":optional");
    const cleanVar = isOptional ? rawVar.replace(":optional", "") : rawVar;

    let value: string | undefined = variables[cleanVar];

    if (value === undefined || value === null) {
      if (cleanVar === "first_name") value = context.firstName ?? undefined;
      else if (cleanVar === "last_name") value = context.lastName ?? undefined;
      else if (cleanVar === "company") value = context.company ?? undefined;
      else if (cleanVar === "setter_name") value = context.setterName ?? undefined;
      else if (cleanVar === "closer_name") value = context.closerName ?? undefined;
      else if (cleanVar === "workspace_name") value = context.workspaceName ?? undefined;
      else if (cleanVar === "meeting_url") value = context.meetingUrl ?? undefined;
    }

    if (value === undefined || value === null || value.trim() === "") {
      if (!isOptional) {
        throw new ValidationError(
          `Missing required template variable: {{${cleanVar}}}. Provide a value or configure variable as {{${cleanVar}:optional}}`
        );
      }
      value = "";
    }

    rendered = rendered.replaceAll(`{{${rawVar}}}`, value);
  }

  return rendered;
}
