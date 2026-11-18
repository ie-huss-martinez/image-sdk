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
  /** The editor's shortcuts, for each button's `aria-keyshortcuts`. */
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
 * with the tool's shortcuts as `aria-keyshortcuts`.
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
      {registry.toolbar.map((group) => {
        const available = group.filter((tool) => tool.isAvailable?.(state) ?? true);
        // A group with nothing to offer, such as the frames for a still, isn't there at all.
        if (available.length === 0) return null;
        return (
          <ToolbarGroup
            key={group.map((tool) => tool.id).join(" ")}
            label={t(`toolbar.groups.${group[0]?.group ?? "other"}`)}
          >
            {available.map((tool) => {
              const Icon = icons[tool.icon];
              const keys = shortcuts?.ariaKeyShortcuts(tool.id);
              const disabled = !(tool.isEnabled?.(state) ?? true);
              // A tool that says why it can't run stays in the keyboard's
              // order, described by the reason, in a tooltip sighted users
              // get too. The others are plainly disabled.
              const reason = disabled ? tool.unavailable?.(state) : undefined;
              const button = (
                <IconButton
                  key={tool.id}
                  data-tool={tool.id}
                  label={t(tool.label)}
                  icon={Icon ? <Icon /> : null}
                  disabled={disabled}
                  {...(reason ? { focusableWhenDisabled: true } : {})}
                  {...(tool.isActive ? { pressed: tool.isActive(state) } : {})}
                  {...(keys ? { "aria-keyshortcuts": keys } : {})}
                  onClick={() => void tool.run(context)}
                />
              );
              return reason ? (
                <Tooltip key={tool.id} content={t(reason)}>
                  {button}
                </Tooltip>
              ) : (
                button
              );
            })}
          </ToolbarGroup>
        );
      })}
    </Toolbar>
  );
}
