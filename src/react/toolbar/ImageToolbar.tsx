import type { ShortcutRegistry, ToolRegistry } from "@hussmartinez/sdk-core";
import {
  IconButton,
  type IconComponent,
  Toolbar,
  ToolbarGroup,
  Tooltip,
} from "@hussmartinez/ui/react";
import type { ReactNode } from "react";
import type { ImageTool, ImageToolContext } from "../../features/tool-types.js";
import { useImageDocument, useImageEditorState, useImageMessages } from "../hooks.js";

/**
 * Props of {@link ImageToolbar}.
 *
 * @public
 */
export interface ImageToolbarProps {
  /** The editor's tools, from `createToolRegistry`. */
  readonly registry: ToolRegistry<ImageTool>;
  /** The editor's shortcuts, for each button's tooltip and `aria-keyshortcuts`. */
  readonly shortcuts?: ShortcutRegistry;
  /** What the tools run against. */
  readonly context: ImageToolContext;
  /** Icon components by name, over the SDK's own. */
  readonly icons: Readonly<Record<string, IconComponent>>;
  readonly className?: string;
}

/**
 * The editor's toolbar (docs/adr/0007): ui's Toolbar, one group per toolbar
 * group of the registry, one button per tool, disabled when it can't run,
 * each with a tooltip of its name and its shortcut, which also sets its
 * `aria-keyshortcuts`. A button that can't run stays focusable, with
 * `aria-disabled`, so it keeps its place in the toolbar's keyboard order and
 * screen readers find it.
 *
 * @public
 */
export function ImageToolbar(props: ImageToolbarProps): ReactNode {
  const { registry, shortcuts, context, icons } = props;
  const messages = useImageMessages();
  const snapshot = useImageDocument();
  const [editor] = useImageEditorState();
  const state = { snapshot, editor };
  const t = messages.t as (key: string) => string;
  return (
    <Toolbar label={messages.t("toolbar.label")} className={props.className}>
      {registry.toolbar.map((group) => (
        <ToolbarGroup
          key={group.map((tool) => tool.id).join(" ")}
          label={t(`toolbar.groups.${group[0]?.group ?? "other"}`)}
        >
          {group
            .filter((tool) => tool.isAvailable?.(state) ?? true)
            .map((tool) => {
              const Icon = icons[tool.icon];
              const label = t(tool.label);
              const shortcut = shortcuts?.describe(tool.id)[0];
              return (
                <Tooltip
                  key={tool.id}
                  type="label"
                  content={label}
                  {...(shortcut ? { shortcut } : {})}
                >
                  <IconButton
                    data-tool={tool.id}
                    label={label}
                    icon={Icon ? <Icon /> : null}
                    disabled={!(tool.isEnabled?.(state) ?? true)}
                    focusableWhenDisabled
                    {...(tool.isActive ? { pressed: tool.isActive(state) } : {})}
                    onClick={() => void tool.run(context)}
                  />
                </Tooltip>
              );
            })}
        </ToolbarGroup>
      ))}
    </Toolbar>
  );
}
