import type { JSONSchema7 } from "json-schema";
import { z } from "zod";
import { themeColorsSchema } from "@/lib/config-schema/zod-schemas";

// Generate the IntelliSense JSON Schema from the zod source via zod v4's built-in generator. A
// generation throw degrades to `undefined` so the editor falls back to syntax-only linting instead
// of crashing the pane.
function toJsonSchema(schema: z.ZodType): JSONSchema7 | undefined {
  try {
    return z.toJSONSchema(schema, { target: "draft-7" }) as JSONSchema7;
  } catch {
    return undefined;
  }
}

export const themeColorsJsonSchema = toJsonSchema(themeColorsSchema);
