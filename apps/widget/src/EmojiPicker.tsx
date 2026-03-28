import React, { useState } from 'react';

const CATEGORIES: Array<{ label: string; icon: string; emojis: string[] }> = [
  {
    label: '表情',
    icon: '😀',
    emojis: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉',
      '😊','😇','🥰','😍','🤩','😘','😋','😛','😜','🤪',
      '🤑','🤗','🤔','😐','😏','😒','🙄','😬','😔','😪',
      '😴','🤤','😷','🤒','🤕','🥵','🥶','😎','🤓','🧐',
      '😕','😟','😢','😭','😱','😡','🤬','😈','👿','💀',
    ],
  },
  {
    label: '手势',
    icon: '👍',
    emojis: [
      '👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉',
      '👆','👇','☝️','👋','🤚','🖐️','✋','🖖','🤜','🤛',
      '💪','🤝','🙏','👏','🤲','🫶',
    ],
  },
  {
    label: '爱心',
    icon: '❤️',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
      '❣️','💕','💞','💓','💗','💖','💘','💝','💟','❤️‍🔥',
      '😍','🥰','💋','💌','💏','💑',
    ],
  },
  {
    label: '自然',
    icon: '🌟',
    emojis: [
      '🌟','✨','🔥','💫','🌈','🌊','🌺','🌸','🌼','🌻',
      '🍀','🌿','🍁','🌙','⭐','🌞','⛅','🌤️','🌧️','⚡',
      '❄️','🌺','🐱','🐶','🐼','🦊','🐸','🦋','🐝','🌴',
    ],
  },
  {
    label: '食物',
    icon: '🎉',
    emojis: [
      '🎉','🎊','🎈','🎁','🎂','🥳','🏆','🥇','🎯','🎮',
      '🎸','🎵','🎶','🎤','🎬','🎨','🎭','🚀','💡','🔑',
      '💎','👑','🌠','🎇','🎆','🎀','🛍️','🎗️','🎟️','🏅',
    ],
  },
  {
    label: '符号',
    icon: '✅',
    emojis: [
      '✅','❌','⭕','❓','❗','💯','🔴','🟠','🟡','🟢',
      '🔵','🟣','⚪','⚫','🔶','🔷','🔸','🔹','▶️','⏸️',
      '⏹️','⏺️','🔁','🔂','🔃','📌','📍','🏷️','💬','🔔',
    ],
  },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

export default function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const [cat, setCat] = useState(0);

  return (
    <div className="ep">
      <div className="ep-tabs">
        {CATEGORIES.map((c, i) => (
          <button
            key={i}
            className={`ep-tab${cat === i ? ' active' : ''}`}
            title={c.label}
            onClick={() => setCat(i)}
          >
            {c.icon}
          </button>
        ))}
      </div>
      <div className="ep-grid">
        {CATEGORIES[cat].emojis.map((e) => (
          <button key={e} className="ep-btn" onClick={() => onSelect(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
