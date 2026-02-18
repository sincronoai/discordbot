import {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
  TextChannel,
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

const N8N_URL  = process.env.N8N_ROUTER_URL || '';
const GUILD_ID = process.env.GUILD_ID       || '';

// ─────────────────────────────────────────────
// Helper: nombre del canal a partir del objeto channel
// ─────────────────────────────────────────────
function getChannelName(channel: any): string {
  if (!channel) return 'desconocido';
  if (channel.isDMBased()) return 'DM';
  return channel.name ?? 'desconocido';
}

// ─────────────────────────────────────────────
// Helper: extrae URLs de un texto
// ─────────────────────────────────────────────
function extractUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.match(urlRegex) ?? [];
}

// ─────────────────────────────────────────────
// Helper: comprueba si un texto tiene patrones de spam/venta
// (pre-filtro ligero antes de llamar a GPT)
// ─────────────────────────────────────────────
function detectSpamPatterns(text: string): string[] {
  const patterns = [
    { regex: /por privado|por dm|te escribo|escríbeme/i,      label: 'intento_contacto_privado' },
    { regex: /mi (canal|perfil|instagram|telegram|whatsapp)/i, label: 'autopromocion' },
    { regex: /https?:\/\//i,                                   label: 'contiene_enlace' },
    { regex: /gratis|free|descuento|oferta|promoción/i,        label: 'oferta_comercial' },
    { regex: /comparte|H10|Jungle Scout|Helium/i,              label: 'herramienta_compartida' },
  ];
  return patterns.filter(p => p.regex.test(text)).map(p => p.label);
}

// ─────────────────────────────────────────────
// Envío central a n8n
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
// EVENTO 1: messageCreate
// Datos extra: channel_name, roles del autor, urls detectadas,
// patrones de spam, attachments, menciones, account_age_days
// ─────────────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (GUILD_ID && message.guildId !== GUILD_ID) return;

  const member       = message.member;
  const urls         = extractUrls(message.content);
  const spamPatterns = detectSpamPatterns(message.content);

  // Antigüedad de la cuenta en días
  const accountAgeDays = Math.floor(
    (Date.now() - message.author.createdTimestamp) / (1000 * 60 * 60 * 24)
  );

  await sendToN8n('messageCreate', {
    id:           message.id,
    content:      message.content,
    channel_id:   message.channelId,
    channel_name: getChannelName(message.channel),
    guild_id:     message.guildId,
    is_dm:        message.channel.isDMBased(),

    author: {
      id:               message.author.id,
      username:         message.author.username,
      display_name:     member?.displayName ?? message.author.username,
      bot:              message.author.bot,
      account_age_days: accountAgeDays,
      roles:            member?.roles.cache
                          .filter(r => r.name !== '@everyone')
                          .map(r => ({ id: r.id, name: r.name })) ?? [],
    },

    // Útil para moderación
    attachments:    message.attachments.map(a => ({
      id:       a.id,
      url:      a.url,
      filename: a.name,
      type:     a.contentType,
    })),
    urls_detected:    urls,
    spam_patterns:    spamPatterns,                    // Pre-filtro ligero
    has_links:        urls.length > 0,
    mentions_users:   message.mentions.users.map(u => ({
      id: u.id, username: u.username,
    })),
    mentions_roles:   message.mentions.roles.map(r => ({
      id: r.id, name: r.name,
    })),
    reply_to_message_id: message.reference?.messageId ?? null,

    timestamp: message.createdTimestamp,
  });
});

// ─────────────────────────────────────────────
// EVENTO 2: messageUpdate
// ─────────────────────────────────────────────
client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
  if (newMsg.author?.bot) return;
  if (GUILD_ID && newMsg.guildId !== GUILD_ID) return;
  if (oldMsg.content === newMsg.content) return;

  const urls         = extractUrls(newMsg.content ?? '');
  const spamPatterns = detectSpamPatterns(newMsg.content ?? '');

  await sendToN8n('messageUpdate', {
    id:           newMsg.id,
    old_content:  oldMsg.content,
    new_content:  newMsg.content,
    channel_id:   newMsg.channelId,
    channel_name: getChannelName(newMsg.channel),
    guild_id:     newMsg.guildId,

    author: {
      id:       newMsg.author?.id,
      username: newMsg.author?.username,
    },

    urls_detected: urls,
    spam_patterns: spamPatterns,
    has_links:     urls.length > 0,
    timestamp:     Date.now(),
  });
});

// ─────────────────────────────────────────────
// EVENTO 3: messageDelete
// ─────────────────────────────────────────────
client.on(Events.MessageDelete, async (message) => {
  if (GUILD_ID && message.guildId !== GUILD_ID) return;

  await sendToN8n('messageDelete', {
    id:           message.id,
    content:      message.content ?? '[no cacheado]',
    channel_id:   message.channelId,
    channel_name: getChannelName(message.channel),
    guild_id:     message.guildId,

    author: {
      id:       message.author?.id,
      username: message.author?.username,
    },

    timestamp: Date.now(),
  });
});

// ─────────────────────────────────────────────
// EVENTO 4: memberAdd
// Datos extra: avatar_url, account_age_days, cuenta nueva (flag)
// ─────────────────────────────────────────────
client.on(Events.GuildMemberAdd, async (member) => {
  if (GUILD_ID && member.guild.id !== GUILD_ID) return;

  const accountAgeDays = Math.floor(
    (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24)
  );

  await sendToN8n('memberAdd', {
    user_id:          member.id,
    username:         member.user.username,
    display_name:     member.displayName,
    avatar_url:       member.user.displayAvatarURL(),
    account_age_days: accountAgeDays,
    is_new_account:   accountAgeDays < 7,       // Flag de cuenta sospechosa
    guild_id:         member.guild.id,
    guild_name:       member.guild.name,
    member_count:     member.guild.memberCount,
    joined_at:        member.joinedTimestamp,
  });
});

// ─────────────────────────────────────────────
// EVENTO 5: memberRemove
// ─────────────────────────────────────────────
client.on(Events.GuildMemberRemove, async (member) => {
  if (GUILD_ID && member.guild.id !== GUILD_ID) return;

  await sendToN8n('memberRemove', {
    user_id:      member.id,
    username:     member.user.username,
    guild_id:     member.guild.id,
    guild_name:   member.guild.name,
    member_count: member.guild.memberCount,
    roles:        (member as any).roles?.cache
                    ?.filter((r: any) => r.name !== '@everyone')
                    ?.map((r: any) => ({ id: r.id, name: r.name })) ?? [],
    timestamp:    Date.now(),
  });
});

// ─────────────────────────────────────────────
// EVENTO 6: reactionAdd
// Datos extra: channel_name, contenido del mensaje original
// ─────────────────────────────────────────────
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  if (GUILD_ID && reaction.message.guildId !== GUILD_ID) return;

  // Fetch para obtener datos completos si están parciales
  const message = reaction.message.partial
    ? await reaction.message.fetch()
    : reaction.message;

  await sendToN8n('reactionAdd', {
    message_id:          message.id,
    message_content:     message.content ?? '',   // Texto del msg original
    message_author_id:   message.author?.id,
    channel_id:          message.channelId,
    channel_name:        getChannelName(message.channel),
    guild_id:            message.guildId,
    emoji:               reaction.emoji.name,
    emoji_id:            reaction.emoji.id ?? null,  // null = emoji nativo
    user_id:             user.id,
    username:            (user as any).username,
    timestamp:           Date.now(),
  });
});

// ─────────────────────────────────────────────
// EVENTO 7: memberUpdate (cambio de roles/apodo)
// ─────────────────────────────────────────────
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (GUILD_ID && newMember.guild.id !== GUILD_ID) return;

  const addedRoles = newMember.roles.cache
    .filter(r => !oldMember.roles.cache.has(r.id))
    .map(r => ({ id: r.id, name: r.name }));

  const removedRoles = oldMember.roles.cache
    .filter(r => !newMember.roles.cache.has(r.id))
    .map(r => ({ id: r.id, name: r.name }));

  const nicknameChanged = oldMember.nickname !== newMember.nickname;

  if (addedRoles.length === 0 && removedRoles.length === 0 && !nicknameChanged) return;

  await sendToN8n('memberUpdate', {
    user_id:          newMember.id,
    username:         newMember.user.username,
    guild_id:         newMember.guild.id,
    old_nickname:     oldMember.nickname ?? null,
    new_nickname:     newMember.nickname ?? null,
    nickname_changed: nicknameChanged,
    added_roles:      addedRoles,
    removed_roles:    removedRoles,
    current_roles:    newMember.roles.cache
                        .filter(r => r.name !== '@everyone')
                        .map(r => ({ id: r.id, name: r.name })),
    timestamp:        Date.now(),
  });
});

// ─────────────────────────────────────────────
// Errores globales
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
