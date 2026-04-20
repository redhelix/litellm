from litellm.integrations.custom_logger import CustomLogger


class MergeSystemMessagesCallback(CustomLogger):
    """Merge consecutive/multiple system messages into one.

    Some vLLM backends (e.g. Qwen3 with --reasoning-parser) reject requests
    that contain more than one system message. OpenCode injects a second system
    message for skill/context injection, triggering this error.
    """

    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        messages = data.get("messages")
        if not messages:
            return data

        system_parts = []
        other_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                content = msg.get("content", "")
                if isinstance(content, list):
                    content = "\n".join(
                        block.get("text", "") for block in content
                        if isinstance(block, dict) and block.get("type") == "text"
                    )
                system_parts.append(content)
            else:
                other_messages.append(msg)

        if len(system_parts) == 0:
            return data

        if len(system_parts) == 1 and messages[0].get("role") == "system":
            return data  # already in position, nothing to do

        merged = {"role": "system", "content": "\n\n".join(system_parts)}
        data["messages"] = [merged] + other_messages
        return data
