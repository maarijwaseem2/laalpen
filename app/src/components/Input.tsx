import { forwardRef } from 'react';
import { TextInput as PaperInput, type TextInputProps } from 'react-native-paper';

/** Paper TextInput that also exposes its label to screen readers (and browser automation). */
const Base = forwardRef<any, TextInputProps>(function Input(props, ref) {
  const label = typeof props.label === 'string' ? props.label : undefined;
  return <PaperInput ref={ref} accessibilityLabel={props.accessibilityLabel ?? label} {...props} />;
});

export const TextInput = Object.assign(Base, { Icon: PaperInput.Icon, Affix: PaperInput.Affix });
