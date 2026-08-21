/**
 * Per-tab error boundary — a rendering failure inside one inspector must never
 * crash the drawer or the host app (§5). Catches, shows an inline warning with a
 * Retry that remounts the subtree.
 */

import { Component, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import type { Theme } from '../../theme/theme';
import type { StringTable } from '../../i18n';
import { TextButton } from './TextButton';
import { StyleSheet } from 'react-native';

interface Props {
  theme: Theme;
  strings: StringTable;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  private retry = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    const { theme, strings } = this.props;
    return (
      <View style={styles.container}>
        <Text
          style={{ color: theme.danger, fontSize: 13, textAlign: 'center' }}
        >
          {strings.inspectorError}
        </Text>
        <TextButton label={strings.retry} onPress={this.retry} tone="accent" />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
});
