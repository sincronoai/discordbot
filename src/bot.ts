import {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
  Message,
  GuildMember,
  MessageReaction,
  User,
} from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
  ],
});

const N8N_URL = process.env.N8N_ROUTER_URL || '';
const GUILD_ID = process.env.GUILD_ID || '';

// ─────────────────────────────────────────────
// Función central: enviar a n8n
// ─────────────────────────────────────────────
async function sendToN8n(eventType: string, data: Record<string, any>) {
  if (!N8N_URL) {
    console.error('❌ N8N_ROUTER_URL no configurada');
    return;
  }

  const payload = {
    event_type: eventType,
    data,
    timestamp: new Date().toISOString(),
  };

  try {
    console.log(`📤 Enviando: ${eventType}`);
    const res = await fetch(N8N_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      console.log(`✅ OK: ${eventType}`);
    } else {
      console.error(`❌ Error ${eventType}: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`❌ Fallo enviando ${eventType}:`, err);
  }
}

// ─────────────────────────────────────────────
// Bot listo
// ─────────────────────────────────────────────
client.once(Events.ClientReady, (c) => {
  console.log(`\n✅ Bot online: ${c.user.tag}`);
  console.log(`🏠 Servidor: ${GUILD_ID || 'TODOS'}`);
  console.log(`🔗 n8n: ${N8N_URL}`);
  console.log('👂 Escuchando todos los eventos...\n');
});

// ─────────────────────────────────────────────
// EVENTO 1: Mensaje en cualquier canal
// ─────────────────────────────────────────────
client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;
  if (GUILD_ID && message.guildId !== GUILD_ID) return;

  await sendToN8n('messageCreate', {
    id: message.id,
    content: message.content,
    channel_id: message.channelId,
    channel_name: (message.channel as any).name ?? 'DM',
    guild_id: message.guildId,
    is_dm: message.channel.isDMBased(),
    author: {
      id: message.author.id,
      username: message.author.username,
      bot: message.author.bot,
    },
    timestamp: message.createdTimestamp,
  });
});

// ─────────────────────────────────────────────
// EVENTO 2: Mensaje editado
// ─────────────────────────────────────────────
client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
  if (newMsg.author?.bot) return;
  if (GUILD_ID && newMsg.guildId !== GUILD_ID) return;
  if (oldMsg.content === newMsg.content) return;

  await sendToN8n('messageUpdate', {
    id: newMsg.id,
    old_content: oldMsg.content,
    new_content: newMsg.content,
    channel_id: newMsg.channelId,
    guild_id: newMsg.guildId,
    author: {
      id: newMsg.author?.id,
      username: newMsg.author?.username,
    },
    timestamp: Date.now(),
  });
});

// ─────────────────────────────────────────────
// EVENTO 3: Mensaje eliminado
// ─────────────────────────────────────────────
client.on(Events.MessageDelete, async (message) => {
  if (GUILD_ID && message.guildId !== GUILD_ID) return;

  await sendToN8n('messageDelete', {
    id: message.id,
    content: message.content ?? '[mensaje no cacheado]',
    channel_id: message.channelId,
    guild_id: message.guildId,
    author: {
      id: message.author?.id,
      username: message.author?.username,
    },
    timestamp: Date.now(),
  });
});

// ─────────────────────────────────────────────
// EVENTO 4: Nuevo miembro
// ─────────────────────────────────────────────
client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
  if (GUILD_ID && member.guild.id !== GUILD_ID) return;

  await sendToN8n('memberAdd', {
    user_id: member.id,
    username: member.user.username,
    guild_id: member.guild.id,
    guild_name: member.guild.name,
    member_count: member.guild.memberCount,
    joined_at: member.joinedTimestamp,
  });
});

// ─────────────────────────────────────────────
// EVENTO 5: Miembro sale
// ─────────────────────────────────────────────
client.on(Events.GuildMemberRemove, async (member) => {
  if (GUILD_ID && member.guild.id !== GUILD_ID) return;

  await sendToN8n('memberRemove', {
    user_id: member.id,
    username: member.user.username,
    guild_id: member.guild.id,
    guild_name: member.guild.name,
    member_count: member.guild.memberCount,
    timestamp: Date.now(),
  });
});

// ─────────────────────────────────────────────
// EVENTO 6: Reacción añadida
// ─────────────────────────────────────────────
client.on(Events.MessageReactionAdd, async (reaction: MessageReaction, user: User) => {
  if (user.bot) return;
  if (GUILD_ID && reaction.message.guildId !== GUILD_ID) return;

  await sendToN8n('reactionAdd', {
    message_id: reaction.message.id,
    channel_id: reaction.message.channelId,
    guild_id: reaction.message.guildId,
    emoji: reaction.emoji.name,
    user_id: user.id,
    username: user.username,
    timestamp: Date.now(),
  });
});

// ─────────────────────────────────────────────
// EVENTO 7: Miembro actualiza roles/apodo
// ─────────────────────────────────────────────
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (GUILD_ID && newMember.guild.id !== GUILD_ID) return;

  const addedRoles = newMember.roles.cache
    .filter(r => !oldMember.roles.cache.has(r.id))
    .map(r => ({ id: r.id, name: r.name }));

  const removedRoles = oldMember.roles.cache
    .filter(r => !newMember.roles.cache.has(r.id))
    .map(r => ({ id: r.id, name: r.name }));

  if (addedRoles.length === 0 && removedRoles.length === 0) return;

  await sendToN8n('memberUpdate', {
    user_id: newMember.id,
    username: newMember.user.username,
    guild_id: newMember.guild.id,
    added_roles: addedRoles,
    removed_roles: removedRoles,
    timestamp: Date.now(),
  });
});

// ─────────────────────────────────────────────
// Errores
// ─────────────────────────────────────────────
client.on(Events.Error, (err) => {
  console.error('❌ Discord Error:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled rejection:', err);
});

// ─────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────
const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error('❌ DISCORD_BOT_TOKEN no configurada');
  process.exit(1);
}

console.log('🔄 Conectando a Discord...');
client.login(token);
