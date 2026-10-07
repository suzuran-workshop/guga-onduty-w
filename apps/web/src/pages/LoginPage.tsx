import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { tokens, Input, Button, Card, Text } from '@fluentui/react-components';
import { Building20Regular, Person20Regular, LockClosed20Regular } from '@fluentui/react-icons';

export default function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await login({ username, password }); }
    catch (err: any) { setError(err.message || 'Login failed'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: tokens.colorNeutralBackground2 }}>
      <Card style={{ width: 400, padding: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: tokens.colorBrandBackground, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
            <Building20Regular color="#fff" />
          </div>
          <Text size={600} weight="bold" style={{ color: tokens.colorNeutralForeground1, display: 'block' }}>{t('app.title')}</Text>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: 4 }}>{t('app.subtitle')}</Text>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}><Input style={{ width: '100%' }} contentBefore={<Person20Regular />} placeholder={t('auth.usernamePlaceholder')} value={username} onChange={e => setUsername(e.currentTarget.value)} /></div>
          <div style={{ marginBottom: 16 }}><Input style={{ width: '100%' }} type="password" contentBefore={<LockClosed20Regular />} placeholder={t('auth.passwordPlaceholder')} value={password} onChange={e => setPassword(e.currentTarget.value)} /></div>
          {error && <Text size={200} style={{ color: tokens.colorPaletteRedForeground1, marginBottom: 8, display: 'block' }}>{error}</Text>}
          <Button appearance="primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: 8 }}>
            {loading ? t('auth.loginLoading') : t('auth.login')}
          </Button>
        </form>

        <div style={{ marginTop: 20, padding: 12, background: tokens.colorNeutralBackground2, borderRadius: 8 }}>
          <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>{t('auth.testAccounts')}</Text>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}><Text size={100}>[A] admin [T] teacher1 [S] student1</Text></div>
        </div>
      </Card>
    </div>
  );
}