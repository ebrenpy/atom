import { useState, useCallback } from 'react';
import { configApi, type User, type Agent, type UserRole, type ConnectionInfo } from '../api/client';

export function useConfig() {
  const [users, setUsers] = useState<User[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastCreated, setLastCreated] = useState<{ agentId: string; secret: string } | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await configApi.listUsers();
      setUsers(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const [data, conn] = await Promise.all([
        configApi.listAgents(),
        configApi.getConnectionInfo().catch(() => null),
      ]);
      setAgents(data);
      setConnectionInfo(conn);
    } finally {
      setLoading(false);
    }
  }, []);

  const addUser = useCallback(
    async (input: { email: string; display_name?: string; role: UserRole }) => {
      await configApi.addUser(input);
      await loadUsers();
    },
    [loadUsers]
  );

  // API 에러(400 last admin 등)는 throw되어 컴포넌트로 전파됨
  // 컴포넌트에서 catch하여 인라인 에러 메시지로 표시한다
  const updateUser = useCallback(
    async (id: string, body: { role?: UserRole; is_active?: boolean }) => {
      await configApi.updateUser(id, body);
      await loadUsers();
    },
    [loadUsers]
  );

  const createAgent = useCallback(
    async (input: { agent_id: string; display_name?: string }) => {
      const result = await configApi.createAgent(input);
      setLastCreated(result.secret ? { agentId: result.agent_id, secret: result.secret } : null);
      await loadAgents();
    },
    [loadAgents]
  );

  const reissueSecret = useCallback(async (id: string) => {
    const result = await configApi.reissueSecret(id);
    setLastCreated({ agentId: result.agent_id, secret: result.secret });
  }, []);

  const updateAgent = useCallback(
    async (id: string, body: { is_active: boolean }) => {
      await configApi.updateAgent(id, body);
      await loadAgents();
    },
    [loadAgents]
  );

  const clearSecret = useCallback(() => setLastCreated(null), []);

  return {
    users,
    agents,
    loading,
    lastCreated,
    connectionInfo,
    clearSecret,
    loadUsers,
    loadAgents,
    addUser,
    updateUser,
    createAgent,
    reissueSecret,
    updateAgent,
  };
}
