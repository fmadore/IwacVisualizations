<?php
namespace IwacVisualizations\Controller\Admin;

use IwacVisualizations\Job\SyncData;
use Laminas\Form\Element;
use Laminas\Form\Form;
use Laminas\Mvc\Controller\AbstractActionController;
use Laminas\View\Model\ViewModel;

/**
 * Admin control surface for the precomputed-data delivery (issue #7).
 *
 * One page with a "Pull latest data" button that dispatches the SyncData job
 * (which downloads the GitHub release archive and unpacks it into
 * files/iwac-visualizations/). Job progress + logs appear in Admin → Jobs;
 * this controller only shows the last-sync status and dispatches the job,
 * guarding against an overlapping run.
 */
class DataController extends AbstractActionController
{
    /** Job statuses that mean a sync is still active. */
    const ACTIVE_STATUSES = ['starting', 'in_progress'];

    public function indexAction()
    {
        $running = $this->findRunningSync();

        $view = new ViewModel([
            'form'     => $this->getSyncForm(),
            'lastSync' => $this->settings()->get(SyncData::SETTING_LAST_SYNC),
            'running'  => $running,
        ]);
        $view->setTemplate('iwac-visualizations/admin/data/index');
        return $view;
    }

    public function syncAction()
    {
        if (!$this->getRequest()->isPost()) {
            return $this->redirect()->toRoute('admin/iwac-visualizations');
        }

        $form = $this->getSyncForm();
        $form->setData($this->params()->fromPost());
        if (!$form->isValid()) {
            $this->messenger()->addError('Invalid or expired form submission. Please try again.'); // @translate
            return $this->redirect()->toRoute('admin/iwac-visualizations');
        }

        // Refuse to start a second sync while one is active.
        $running = $this->findRunningSync();
        if ($running) {
            $this->messenger()->addWarning('A data sync is already running.'); // @translate
            return $this->redirect()->toRoute('admin/id', [
                'controller' => 'job', 'action' => 'show', 'id' => $running->id(),
            ]);
        }

        $args = [];
        $tag = trim((string) $form->get('tag')->getValue());
        if ($tag !== '') {
            $args['tag'] = $tag;
        }

        $job = $this->jobDispatcher()->dispatch(SyncData::class, $args);
        $this->messenger()->addSuccess('Data sync started. Watch its progress below.'); // @translate

        return $this->redirect()->toRoute('admin/id', [
            'controller' => 'job', 'action' => 'show', 'id' => $job->getId(),
        ]);
    }

    /**
     * Find an active SyncData job, if any (newest first).
     *
     * @return \Omeka\Api\Representation\JobRepresentation|null
     */
    private function findRunningSync()
    {
        foreach (self::ACTIVE_STATUSES as $status) {
            $response = $this->api()->search('jobs', [
                'class'  => SyncData::class,
                'status' => $status,
                'sort_by' => 'id',
                'sort_order' => 'desc',
                'limit'  => 1,
            ]);
            $content = $response->getContent();
            if (!empty($content)) {
                return $content[0];
            }
        }
        return null;
    }

    /** Build the sync form: a CSRF token + an optional release-tag override. */
    private function getSyncForm(): Form
    {
        $form = new Form('iwac-sync');
        $form->setAttribute('method', 'post');
        $form->setAttribute('action', $this->url()->fromRoute('admin/iwac-visualizations/sync'));

        $form->add([
            'type'    => Element\Text::class,
            'name'    => 'tag',
            'options' => [
                'label' => 'Release tag (optional)', // @translate
                'info'  => 'Leave blank to pull the latest build from the moving “data” release.', // @translate
            ],
            'attributes' => [
                'id'          => 'iwac-sync-tag',
                'placeholder' => 'data',
            ],
        ]);

        $form->add([
            'type' => Element\Csrf::class,
            'name' => 'sync_token',
        ]);

        return $form;
    }
}
