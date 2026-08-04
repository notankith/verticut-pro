export type TemplateWindow = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type TemplateDef = {
  id: string;
  name: string;
  overlayUrl: string;
};

export const DEFAULT_TEMPLATE_WINDOW: TemplateWindow = {
  left: 12,
  top: 15,
  width: 76,
  height: 60,
};

export const TEMPLATES: TemplateDef[] = [
  {
    id: "ES1",
    name: "ES1",
    overlayUrl: "https://i.ibb.co/hJL674t8/Gradient-Overlay.png",
  },
];

export function getTemplateById(id: string | null | undefined) {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}
