import { useState } from 'react';
import { KeyboardAvoidingView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api/client';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { useAuth } from '@/store/useAuth';
import { Radius, Spacing, Type, useTheme } from '@/theme';

export default function SignIn() {
  const { colors } = useTheme();
  const signIn = useAuth((s) => s.signIn);
  const [step, setStep] = useState<'details' | 'code'>('details');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /** Shown while there is no SMS provider, so anyone can sign in to the demo. */
  const [demoCode, setDemoCode] = useState<string>();

  const input = [styles.input, { backgroundColor: colors.surface, color: colors.text }];
  const digits = phone.replace(/\D/g, '');

  const sendCode = async () => {
    setError('');
    setLoading(true);
    try {
      const sent = await api.startSignIn(digits);
      setDemoCode(sent.demoCode);
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't send a code. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setError('');
    setLoading(true);
    try {
      const { token } = await api.verifySignIn({ name: name.trim(), phone: digits, code });
      signIn({ name: name.trim(), phone: digits, ...(token ? { token } : {}) });
    } catch (e) {
      const message = e instanceof Error ? e.message : "That code didn't match";
      setError(demoCode ? `${message}. (Demo code: ${demoCode})` : `${message}.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView behavior="padding" style={styles.root}>
        {step === 'details' ? (
          <View style={styles.form}>
            <Text variant="title">What should we call you?</Text>
            <TextInput
              style={input}
              placeholder="Full name"
              placeholderTextColor={colors.textSecondary}
              value={name}
              onChangeText={setName}
              autoComplete="name"
              textContentType="name"
              autoFocus
            />
            <TextInput
              style={input}
              placeholder="Mobile number"
              placeholderTextColor={colors.textSecondary}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
            />
            <Text variant="caption" tone="secondary">
              We’ll text you a code to confirm your number.
            </Text>
            {error ? <Text tone="danger">{error}</Text> : null}
          </View>
        ) : (
          <View style={styles.form}>
            <Text variant="title">Enter the 4-digit code</Text>
            <Text tone="secondary">Sent to {phone}.{demoCode ? ` For this demo, use ${demoCode}.` : ''}</Text>
            <TextInput
              style={[input, styles.code]}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              maxLength={4}
              autoFocus
            />
            {error ? <Text tone="danger">{error}</Text> : null}
            <Button title="Change number" variant="ghost" onPress={() => (setError(''), setStep('details'))} />
          </View>
        )}
        {step === 'details' ? (
          <Button title="Continue" onPress={sendCode} loading={loading} disabled={!name.trim() || digits.length < 7} />
        ) : (
          <Button title="Verify" onPress={verify} loading={loading} disabled={code.length < 4} />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: Spacing.xl, paddingTop: 80, justifyContent: 'space-between' },
  form: { gap: Spacing.md },
  input: { ...Type.body, height: 54, borderRadius: Radius.md, paddingHorizontal: Spacing.lg },
  code: { fontSize: 28, letterSpacing: 16, textAlign: 'center', fontWeight: '700' },
});
