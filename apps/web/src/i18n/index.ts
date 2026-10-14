/**
 * i18n —— 中英双语（AGENTS.md 要求：文案经 t() 包裹）。
 * 保留迁移前全部 ~130 个 key（结构与旧 i18n/index.ts 一致），并补齐新页面/组件所需 key。
 * 单一 translation 命名空间，资源内联（无 http 后端，冷启动即可用）。
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  'zh-CN': {
    translation: {
      app: { title: '校园值周管理', subtitle: 'Class Duty Management System' },
      auth: { login: '登录', logout: '退出', username: '用户名', password: '密码', loginLoading: '登录中...', passwordPlaceholder: '请输入密码', usernamePlaceholder: '请输入用户名', testAccounts: '测试账号（密码均为 123456）：', loginFailed: '登录失败' },
      nav: { dashboard: '看板', records: '值周记录', stats: '统计排名', summary: '每日小结', appeals: '申诉管理', awards: '流动红旗', config: '配置中心', settings: '系统设置', bigscreen: '大屏' },
      roles: { admin: '管理员', teacher: '教师', student: '值周生' },
      common: { save: '保存', cancel: '取消', delete: '删除', edit: '编辑', create: '创建', refresh: '刷新', search: '搜索', export: '导出', import: '导入', confirm: '确认', submit: '提交', loading: '加载中...', noData: '暂无数据', back: '返回', close: '关闭', all: '全部', actions: '操作', name: '名称', status: '状态', week: '周次', campus: '校区', grade: '年级', class: '班级', success: '操作成功', failed: '操作失败' },
      dashboard: { todayRecords: '今日记录', todayPositive: '今日加分', todayNegative: '今日扣分', weekBest: '本周最优', weekTop5: '本周排名 Top 5', recentRecords: '最新记录' },
      records: { title: '值周记录', newRecord: '新增记录', quickTemplate: '快速模板', class: '班级', week: '周次', tag: '评价标签', score: '分数', tagDefaultScore: '标签默认分', comment: '文字说明', commentPlaceholder: '例：3楼走廊卫生整洁...', uploadImage: '点击上传图片', maxImages: '最多9张', filterByWeek: '按周筛选', filterByClass: '按班级筛选', recordList: '记录列表', status: { active: '正常', revoked: '已撤回', appealing: '申诉中', appeal_approved: '申诉通过' }, revoke: '撤回', appeal: '申诉', appealReason: '请输入申诉理由：', confirmRevoke: '确认撤回此记录？', selectClassAndTag: '请选择班级', recorder: '记录人', time: '时间', created: '记录已创建', revokedOk: '已撤回', appealedOk: '申诉已提交', uploadFailed: '图片上传失败' },
      stats: { title: '统计排名', ranking: '班级排名', trend: '趋势图', detail: '明细', exportCSV: '导出 CSV', selectClass: '请选择班级', selectGrade: '全部年级', recentTrend: '近8周趋势', rank: '排名', className: '班级', totalScore: '总分', positiveCount: '加分次数', negativeCount: '扣分次数', recordCount: '记录数' },
      summary: { title: '每日小结', newSummary: '新增小结', date: '日期', content: '小结内容（支持 Markdown）', autoHint: '留空将自动生成本周排名摘要...', historySummaries: '历史小结', autoContent: '今日无值周记录。', weekRanking: '{{week}} 周排名', created: '小结已保存' },
      appeals: { title: '申诉管理', allStatus: '全部状态', pending: '待审批', approved: '已批准', rejected: '已驳回', teacher: '申诉人', reason: '申诉理由', reviewer: '审批人', approve: '批准', reject: '驳回', reviewComment: '审批意见', approvedOk: '已批准', rejectedOk: '已驳回', recordInfo: '关联记录' },
      awards: { title: '流动红旗', awardButton: '颁发流动红旗', awarding: '评选中...', confirmAward: '确认为 {{week}} 颁发流动红旗？将自动评选各年级最高分班级。', noRecords: '暂无流动红旗记录，点击上方按钮自动评选', awardedAt: '颁发时间', awardedOk: '流动红旗已颁发', category: '类别', note: '备注' },
      config: { title: '配置中心', tabs: { campuses: '校区', grades: '年级', classes: '班级', users: '用户', groups: '值周小组', tags: '标签', templates: '模板' }, newItem: '新增', editItem: '编辑', deleteConfirm: '确认删除？', code: '代号', sortOrder: '排序', classTeacher: '班主任', displayName: '姓名', role: '角色', members: '成员', score: '分值', color: '颜色', category: '类别', isSystem: '系统标签', tagIds: '标签', createdOk: '创建成功', updatedOk: '更新成功', deletedOk: '删除成功' },
      settings: { title: '系统设置', campusSettings: '校区设置', appealToggle: '申诉功能', appealDesc: '开启后班主任可对值周记录发起申诉', notifyToggle: '自动通知教师', notifyDesc: '每日小结自动推送给相关教师', enabled: '已开启', disabled: '已关闭', importTemplates: '导入模板', exportTemplates: '导出模板', savedOk: '设置已保存' },
      bigscreen: { title: '校园值周数字大屏', todayRecords: '今日记录', todayPositive: '今日加分', todayNegative: '今日扣分', bestClass: '最优班级', weekRankingTop10: '本周排名 Top 10', liveFeed: '实时记录滚动', live: '实时', noRecords: '暂无记录' },
      error: { unauthorized: '请先登录', forbidden: '权限不足', notFound: '资源不存在', network: '网络错误' },
    },
  },
  en: {
    translation: {
      app: { title: 'Class Duty Management', subtitle: 'Class Duty Management System' },
      auth: { login: 'Sign In', logout: 'Sign Out', username: 'Username', password: 'Password', loginLoading: 'Signing in...', passwordPlaceholder: 'Enter password', usernamePlaceholder: 'Enter username', testAccounts: 'Test accounts (password: 123456):', loginFailed: 'Sign in failed' },
      nav: { dashboard: 'Dashboard', records: 'Duty Records', stats: 'Statistics', summary: 'Daily Summary', appeals: 'Appeals', awards: 'Red Flag', config: 'Configuration', settings: 'Settings', bigscreen: 'Big Screen' },
      roles: { admin: 'Admin', teacher: 'Teacher', student: 'Prefect' },
      common: { save: 'Save', cancel: 'Cancel', delete: 'Delete', edit: 'Edit', create: 'Create', refresh: 'Refresh', search: 'Search', export: 'Export', import: 'Import', confirm: 'Confirm', submit: 'Submit', loading: 'Loading...', noData: 'No data', back: 'Back', close: 'Close', all: 'All', actions: 'Actions', name: 'Name', status: 'Status', week: 'Week', campus: 'Campus', grade: 'Grade', class: 'Class', success: 'Success', failed: 'Failed' },
      dashboard: { todayRecords: 'Today Records', todayPositive: 'Today Positive', todayNegative: 'Today Negative', weekBest: 'Best Class', weekTop5: 'Weekly Top 5', recentRecords: 'Recent Records' },
      records: { title: 'Duty Records', newRecord: 'New Record', quickTemplate: 'Templates', class: 'Class', week: 'Week', tag: 'Tag', score: 'Score', tagDefaultScore: 'Tag Default', comment: 'Comment', commentPlaceholder: 'e.g. Clean hallway on 3F...', uploadImage: 'Click to upload', maxImages: 'Max 9 images', filterByWeek: 'Filter by Week', filterByClass: 'Filter by Class', recordList: 'Record List', status: { active: 'Active', revoked: 'Revoked', appealing: 'Appealing', appeal_approved: 'Approved' }, revoke: 'Revoke', appeal: 'Appeal', appealReason: 'Enter appeal reason:', confirmRevoke: 'Confirm revoke?', selectClassAndTag: 'Select a class', recorder: 'Recorder', time: 'Time', created: 'Record created', revokedOk: 'Revoked', appealedOk: 'Appeal submitted', uploadFailed: 'Image upload failed' },
      stats: { title: 'Statistics', ranking: 'Rankings', trend: 'Trend', detail: 'Details', exportCSV: 'Export CSV', selectClass: 'Select a class', selectGrade: 'All Grades', recentTrend: '8-Week Trend', rank: 'Rank', className: 'Class', totalScore: 'Score', positiveCount: 'Positive', negativeCount: 'Negative', recordCount: 'Records' },
      summary: { title: 'Daily Summary', newSummary: 'New Summary', date: 'Date', content: 'Content (Markdown)', autoHint: 'Leave blank to auto-generate...', historySummaries: 'History', autoContent: 'No records today.', weekRanking: '{{week}} Rankings', created: 'Summary saved' },
      appeals: { title: 'Appeals', allStatus: 'All', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', teacher: 'Appellant', reason: 'Reason', reviewer: 'Reviewer', approve: 'Approve', reject: 'Reject', reviewComment: 'Comment', approvedOk: 'Approved', rejectedOk: 'Rejected', recordInfo: 'Related Record' },
      awards: { title: 'Red Flag Awards', awardButton: 'Award Red Flag', awarding: 'Awarding...', confirmAward: 'Confirm {{week}} red flag? Top class per grade will be selected.', noRecords: 'No awards yet. Click above to auto-award.', awardedAt: 'Awarded at', awardedOk: 'Red flag awarded', category: 'Category', note: 'Note' },
      config: { title: 'Configuration', tabs: { campuses: 'Campuses', grades: 'Grades', classes: 'Classes', users: 'Users', groups: 'Groups', tags: 'Tags', templates: 'Templates' }, newItem: 'New', editItem: 'Edit', deleteConfirm: 'Confirm delete?', code: 'Code', sortOrder: 'Order', classTeacher: 'Teacher', displayName: 'Name', role: 'Role', members: 'Members', score: 'Score', color: 'Color', category: 'Category', isSystem: 'System', tagIds: 'Tags', createdOk: 'Created', updatedOk: 'Updated', deletedOk: 'Deleted' },
      settings: { title: 'Settings', campusSettings: 'Campus Settings', appealToggle: 'Appeal Feature', appealDesc: 'Allow teachers to appeal duty records', notifyToggle: 'Auto-Notify', notifyDesc: 'Auto-push daily summaries to teachers', enabled: 'Enabled', disabled: 'Disabled', importTemplates: 'Import Templates', exportTemplates: 'Export Templates', savedOk: 'Settings saved' },
      bigscreen: { title: 'Campus Duty Big Screen', todayRecords: 'Records', todayPositive: 'Positive', todayNegative: 'Negative', bestClass: 'Best', weekRankingTop10: 'Weekly Top 10', liveFeed: 'Live Feed', live: 'LIVE', noRecords: 'No records' },
      error: { unauthorized: 'Please sign in', forbidden: 'Forbidden', notFound: 'Not found', network: 'Network error' },
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
});

export default i18n;
