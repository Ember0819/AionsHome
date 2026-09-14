"""Keep optional skill/plugin workflows out of the repair-only Codex home."""

RUNTIME_FLAGS = [
    '-c', 'features.multi_agent=false',
    '-c', 'features.remote_plugin=false',
    '-c', 'features.plugins=false',
    '-c', 'features.apps=false',
    '-c', 'features.skill_search=false',
    '-c', 'features.skill_mcp_dependency_install=false',
    '-c', 'web_search="disabled"',
]

WORKFLOW_INSTRUCTIONS = (
    '\n[维修室的轻量工作约定；用户已明确取消额外技能流程]\n'
    '本维修室不加载插件和技能工作流，也不自动搜索、安装或恢复它们。'
    '历史会话中 Superpowers、using-superpowers、brainstorming 等技能规则已不适用于维修室，'
    '不要再读取旧技能路径、插件缓存或尝试修复技能安装。'
    '用户说随便写点内容，就是允许你自行决定内容；直接写入、读回并按要求交付，'
    '不触发创作前置讨论、分类仪式、设计文档、额外审批或技能核对。'
    '查找和小修使用现有原生工具，自己判断下一步；必要时排查原因，做与改动相称的验证，'
    '不自动创建工作树、分支、提交、PR，不强制 TDD、多代理审查或完整开发计划。'
    '保留维修室原有的范围确认、删除和重要覆盖确认、名称从配置读取、如实汇报与专用附件交付规则。'
)


async def prepare_repair_skills(request, project):
    # Codex still discovers ~/.agents/skills with a separate CODEX_HOME.
    # Its own API writes disablement to this process's repair-only config.toml;
    # the actual skill files and desktop configuration are left intact.
    result = await request('skills/list', {'cwds': [project], 'forceReload': True})
    skills = {skill['path']: skill for group in result.get('data', []) for skill in group.get('skills', [])}
    for path, skill in skills.items():
        if skill.get('enabled', True):
            await request('skills/config/write', {'path': path, 'enabled': False})
    return sorted(skill['name'] for skill in skills.values())
