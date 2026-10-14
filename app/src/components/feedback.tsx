import { type ReactNode, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, Dialog, HelperText, Menu, Portal, Snackbar, Text } from 'react-native-paper';
import { TextInput } from '@/components/Input';
import { create } from 'zustand';
import { errorText } from '@/lib/query';
import { useAppTheme } from './ui';

// ---------- toasts ----------
type ToastAction = { label: string; onPress: () => void };
const useToastStore = create<{ msg: string | null; error: boolean; action: ToastAction | null; show: (m: string, error?: boolean, action?: ToastAction) => void; hide: () => void }>((set) => ({
  msg: null,
  error: false,
  action: null,
  show: (msg, error = false, action) => set({ msg, error, action: action ?? null }),
  hide: () => set({ msg: null, action: null }),
}));
/** Short message at the bottom. Pass an action for "Undo"-style buttons (shown longer). */
export const toast = (m: string, action?: ToastAction) => useToastStore.getState().show(m, false, action);
export const toastError = (e: unknown) => useToastStore.getState().show(errorText(e), true);

export function Toaster() {
  const { msg, error, action, hide } = useToastStore();
  const t = useAppTheme();
  return (
    <Snackbar
      visible={!!msg}
      onDismiss={hide}
      duration={error ? 5000 : action ? 7000 : 2800}
      style={{ backgroundColor: error ? t.colors.error : t.colors.inverseSurface, maxWidth: 560, alignSelf: 'center' }}
      action={action ? { label: action.label, onPress: () => { hide(); action.onPress(); }, textColor: t.colors.inversePrimary } : { label: 'OK', onPress: hide, textColor: error ? '#fff' : t.colors.inversePrimary }}
    >
      {msg}
    </Snackbar>
  );
}

// ---------- confirm ----------
export function Confirm({ visible, title, body, confirmLabel, destructive, onCancel, onConfirm, busy }: { visible: boolean; title: string; body: string; confirmLabel: string; destructive?: boolean; onCancel: () => void; onConfirm: () => void; busy?: boolean }) {
  const t = useAppTheme();
  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onCancel} style={{ maxWidth: 460, alignSelf: 'center', width: '92%' }}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium">{body}</Text>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onCancel}>Cancel</Button>
          <Button mode="contained" loading={busy} disabled={busy} buttonColor={destructive ? t.colors.error : undefined} onPress={onConfirm}>
            {confirmLabel}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

// ---------- form dialog ----------
export interface Field {
  key: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'select' | 'multiline';
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
}

export function FormDialog({ visible, title, fields, initial, submitLabel, onDismiss, onSubmit }: {
  visible: boolean;
  title: string;
  fields: Field[];
  initial?: Record<string, string>;
  submitLabel: string;
  onDismiss: () => void;
  onSubmit: (values: Record<string, string>) => Promise<unknown>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setValues(initial ?? {});
      setError(null);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const missing = fields.find((f) => f.required && !values[f.key]?.trim());
    if (missing) return setError(`${missing.label} is required`);
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
      onDismiss();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={{ maxWidth: 520, alignSelf: 'center', width: '94%', maxHeight: '90%' }}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.ScrollArea style={{ paddingHorizontal: 24 }}>
          <ScrollView contentContainerStyle={{ paddingVertical: 8, gap: 10 }} keyboardShouldPersistTaps="handled">
            {fields.map((f) =>
              f.type === 'select' ? (
                <SelectField key={f.key} field={f} value={values[f.key] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
              ) : (
                <View key={f.key}>
                  <TextInput
                    mode="outlined"
                    label={f.label + (f.required ? ' *' : '')}
                    value={values[f.key] ?? ''}
                    placeholder={f.placeholder}
                    onChangeText={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                    keyboardType={f.type === 'email' ? 'email-address' : f.type === 'number' ? 'numeric' : 'default'}
                    autoCapitalize={f.type === 'email' || f.type === 'password' ? 'none' : 'sentences'}
                    secureTextEntry={f.type === 'password'}
                    multiline={f.type === 'multiline'}
                    numberOfLines={f.type === 'multiline' ? 3 : 1}
                  />
                  {f.help ? <HelperText type="info">{f.help}</HelperText> : null}
                </View>
              ),
            )}
            {error ? (
              <HelperText type="error" visible>
                {error}
              </HelperText>
            ) : null}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Cancel</Button>
          <Button mode="contained" onPress={submit} loading={busy} disabled={busy}>
            {submitLabel}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

function SelectField({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = field.options?.find((o) => o.value === value);
  return (
    <Menu
      visible={open}
      onDismiss={() => setOpen(false)}
      anchor={
        <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${field.label}: ${selected?.label ?? 'not chosen'}`}>
          <View pointerEvents="none">
            <TextInput
              mode="outlined"
              label={field.label + (field.required ? ' *' : '')}
              value={selected?.label ?? ''}
              placeholder={field.options?.length ? 'Choose…' : 'Nothing to choose yet'}
              editable={false}
              right={<TextInput.Affix text="▾" />}
            />
          </View>
        </Pressable>
      }
    >
      <ScrollView style={{ maxHeight: 320 }}>
        {!field.options?.length ? <Menu.Item title="Nothing to choose yet" disabled /> : null}
        {(field.options ?? []).map((o) => (
          <Menu.Item
            key={o.value}
            title={o.label}
            onPress={() => {
              onChange(o.value);
              setOpen(false);
            }}
          />
        ))}
      </ScrollView>
    </Menu>
  );
}

export function useDialog<T = true>() {
  const [state, setState] = useState<T | null>(null);
  return { value: state, open: (v?: T) => setState((v ?? true) as T), close: () => setState(null), visible: state !== null };
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <HelperText type="error" visible>
      {children}
    </HelperText>
  );
}
