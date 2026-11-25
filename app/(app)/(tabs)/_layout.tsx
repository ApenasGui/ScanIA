import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { colors } from '@/theme';
import type { IconName } from '@/utils/icons';

function tabIcon(name: IconName) {
  // Função com nome: o React mostra "TabIcon" nas ferramentas de debug.
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    // A aba pode mandar cor "null"; o ícone só aceita texto.
    return (
      <Ionicons
        name={name}
        size={size}
        color={typeof color === 'string' ? color : undefined}
      />
    );
  };
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Notas', tabBarIcon: tabIcon('receipt') }}
      />
      <Tabs.Screen
        name="scan"
        options={{ title: 'Escanear', tabBarIcon: tabIcon('camera') }}
      />
      <Tabs.Screen
        name="summary"
        options={{ title: 'Resumo', tabBarIcon: tabIcon('pie-chart') }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Perfil', tabBarIcon: tabIcon('person') }}
      />
    </Tabs>
  );
}
