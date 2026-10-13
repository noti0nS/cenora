'use client';
import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Children, cloneElement, isValidElement, useId, useState } from 'react';
import { X, Loader2, KeyRound, Copy, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import * as m from 'motion/react-m';
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
  onCloseAutoFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={clsx('modal', className)}
          onCloseAutoFocus={onCloseAutoFocus}
          onOpenAutoFocus={(event) => {
            const target = (event.currentTarget as HTMLElement)?.querySelector<HTMLElement>(
              '[data-autofocus]',
            );
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
        >
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description className={description ? 'modal-description' : 'sr-only'}>
                {description || `Detalhes de ${title}`}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Fechar">
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Dropdown({
  trigger,
  children,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="dropdown" align="end" sideOffset={10}>
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
export function MenuItem({
  children,
  onSelect,
  danger = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Menu.Item
      className={clsx('menu-item', danger && 'danger')}
      onSelect={onSelect}
      disabled={disabled}
    >
      {children}
    </Menu.Item>
  );
}
export const Separator = () => <Menu.Separator className="separator" />;
export function MenuCheckboxItem({
  children,
  checked,
  onCheckedChange,
}: {
  children: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Menu.CheckboxItem className="menu-item" checked={checked} onCheckedChange={onCheckedChange}>
      {children}
      <Menu.ItemIndicator className="menu-selection">
        <Check size={15} />
      </Menu.ItemIndicator>
    </Menu.CheckboxItem>
  );
}
export function MenuRadioItems({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Menu.RadioGroup aria-label={label} value={value} onValueChange={onChange}>
      {options.map((option) => (
        <Menu.RadioItem key={option.value} className="menu-item" value={option.value}>
          {option.label}
          <Menu.ItemIndicator className="menu-selection">
            <Check size={15} />
          </Menu.ItemIndicator>
        </Menu.RadioItem>
      ))}
    </Menu.RadioGroup>
  );
}
export function Button({
  children,
  busy = false,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button {...props} disabled={props.disabled || busy} className={clsx('button', className)}>
      {busy && <Loader2 size={16} className="spin" />}
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const hintId = `${fieldId}-hint`;
  let controlId: string | undefined;
  type FieldElement = {
    children?: React.ReactNode;
    id?: string;
    'aria-labelledby'?: string;
    'aria-describedby'?: string;
  };
  const labelControls = (nodes: React.ReactNode): React.ReactNode =>
    Children.map(nodes, (node) => {
      if (!isValidElement<FieldElement>(node)) return node;
      if (['input', 'textarea', 'select'].includes(String(node.type))) {
        const id = node.props.id || fieldId;
        controlId ??= id;
        return cloneElement(node, {
          id,
          'aria-labelledby': node.props['aria-labelledby'] || labelId,
          'aria-describedby': node.props['aria-describedby'] || (hint ? hintId : undefined),
        });
      }
      return node.props.children
        ? cloneElement(node, { children: labelControls(node.props.children) })
        : node;
    });
  const controls = labelControls(children);
  return (
    <div className="field">
      <label id={labelId} htmlFor={controlId}>
        {label}
      </label>
      {controls}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}
export async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    toast.success('Código copiado.');
  } catch {
    toast.error('Selecione o código para copiar.');
  }
}
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div role="group" aria-label={label} className={clsx('segmented-pill', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={value === option.value ? 'selected' : ''}
          onClick={() => onChange(option.value)}
        >
          {value === option.value && (
            <m.span
              layoutId={`${id}-pill`}
              className="segmented-thumb"
              transition={{ type: 'spring', stiffness: 520, damping: 38 }}
            />
          )}
          <span className="segmented-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
export function CodeReveal({
  label,
  value,
  onDone,
}: {
  label: string;
  value: string;
  onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="stack code-result">
      <div className="success-mark">
        <KeyRound size={22} />
      </div>
      <h3>{label}</h3>
      <p className="muted-note">Guarde agora. O código aparece apenas desta vez.</p>
      <code>{value}</code>
      <Button className="secondary" onClick={() => copyCode(value)}>
        <Copy size={15} />
        Copiar código
      </Button>
      <label className="check-label">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        Guardei o código.
      </label>
      <Button disabled={!saved} onClick={onDone}>
        Tudo certo
        <Check size={15} />
      </Button>
    </div>
  );
}
